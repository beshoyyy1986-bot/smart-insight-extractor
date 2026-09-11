import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const credsSchema = z.object({
  uid: z.string().min(1),
  dtsg: z.string().min(1),
  jazoest: z.string().optional().nullable(),
  lsd: z.string().optional().nullable(),
  cookieString: z.string().min(1),
});

type Creds = z.infer<typeof credsSchema>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function baseParams(c: Creds) {
  const p: Record<string, string> = {
    av: c.uid,
    __user: c.uid,
    __a: "1",
    fb_dtsg: c.dtsg,
    fb_api_caller_class: "RelayModern",
    server_timestamps: "true",
  };
  if (c.jazoest) p["jazoest"] = c.jazoest;
  if (c.lsd) p["lsd"] = c.lsd;
  return p;
}

function fbHeaders(c: Creds, friendlyName?: string) {
  const h: Record<string, string> = {
    cookie: c.cookieString,
    "user-agent": UA,
    "x-fb-lsd": c.lsd ?? "",
    "x-asbd-id": "129477",
    "x-fb-friendly-name": friendlyName ?? "",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://www.facebook.com",
    referer: "https://www.facebook.com/adsmanager/manage/campaigns",
  };
  return h;
}

function parseFbResponse(text: string) {
  const content = text.replace(/^for \(;;\);/, "");
  let result: Record<string, unknown> = {};
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") {
        result = { ...result, ...obj };
      }
    } catch {
      /* ignore non-json chunks */
    }
  }
  return result;
}

// ─── Universal input parser ────────────────────────────────────────────────
// Accepts: raw cookie string, curl command, HTTP request paste, JSON, or
// any blob that happens to contain the tokens we need. Returns whatever we
// can identify. Nothing is required.
export function parseAnyInput(raw: string): {
  cookieString: string | null;
  uid: string | null;
  dtsg: string | null;
  lsd: string | null;
  jazoest: string | null;
  act: string | null;
  pageId: string | null;
  businessId: string | null;
} {
  const out = {
    cookieString: null as string | null,
    uid: null as string | null,
    dtsg: null as string | null,
    lsd: null as string | null,
    jazoest: null as string | null,
    act: null as string | null,
    pageId: null as string | null,
    businessId: null as string | null,
  };
  if (!raw || !raw.trim()) return out;

  const text = raw.trim();

  // 1) Try to find a Cookie: header inside a curl/HTTP paste
  const cookieHeaderRe = /(?:^|\n|\s|-H\s*['"]|--header\s*['"]|-b\s*['"])[Cc]ookie:\s*([^'"\n\r]+)['"]?/;
  const cookieHeaderMatch = text.match(cookieHeaderRe);
  let cookieRaw = cookieHeaderMatch?.[1] ?? null;

  // 2) If no explicit header, use the whole input if it looks like cookies (contains c_user=)
  if (!cookieRaw && /(^|[;\s])c_user=/.test(text)) {
    cookieRaw = text;
  }

  if (cookieRaw) {
    // Normalize separators
    const normalized = cookieRaw.replace(/[\r\n]+/g, ";").replace(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/g, ";");
    const map: Record<string, string> = {};
    for (const part of normalized.split(";")) {
      const t = part.trim();
      if (!t) continue;
      const i = t.indexOf("=");
      if (i > 0) {
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        if (k && v && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) map[k] = v;
      }
    }
    if (Object.keys(map).length) {
      const essential = ["c_user", "xs", "fr", "datr", "sb", "dpr", "wd", "locale", "presence", "ps_l", "ps_n"];
      const parts: string[] = [];
      for (const k of essential) if (map[k]) parts.push(`${k}=${map[k]}`);
      for (const [k, v] of Object.entries(map)) if (!essential.includes(k)) parts.push(`${k}=${v}`);
      out.cookieString = parts.join("; ");
      if (map["c_user"]) out.uid = map["c_user"];
      if (map["fb_dtsg"]) out.dtsg = map["fb_dtsg"];
      if (map["lsd"]) out.lsd = map["lsd"];
    }
  }

  // 3) Scan the raw text for tokens (works for HTML pastes, JSON pastes, curl bodies)
  if (!out.dtsg) {
    const dtsgPatterns: RegExp[] = [
      /"dtsg"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/,
      /\\"dtsg\\":\{\\"token\\":\\"([^"\\]+)\\"/,
      /"token"\s*:\s*"(NAc[^"\\]{10,})"/,
      /name=\\?"fb_dtsg\\?"\s+value=\\?"([^"\\]+)\\?"/,
      /fb_dtsg["'\s:=]+([A-Za-z0-9:_\-]{20,})/,
      /DTSGInitialData[^}]*"token"\s*:\s*"([^"]+)"/,
      /"dtsg_token"\s*:\s*"([^"]+)"/,
      /--data-raw\s+['"][^'"]*fb_dtsg=([^&'"\s]+)/,
      /&fb_dtsg=([^&'"\s]+)/,
      /\bfb_dtsg=([A-Za-z0-9:_\-%]+)/,
    ];
    for (const re of dtsgPatterns) {
      const m = text.match(re);
      if (m?.[1]) {
        out.dtsg = decodeURIComponent(m[1].replace(/\\\//g, "/"));
        break;
      }
    }
  }

  if (!out.lsd) {
    const lsdPatterns: RegExp[] = [
      /"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/,
      /\\"LSD\\",\[\],\{\\"token\\":\\"([^"\\]+)\\"/,
      /name=\\?"lsd\\?"\s+value=\\?"([^"\\]+)\\?"/,
      /"lsd"\s*:\s*\{"token"\s*:\s*"([^"]+)"/,
      /-H\s+['"]x-fb-lsd:\s*([^'"\s]+)/i,
      /\blsd=([A-Za-z0-9_\-]+)/,
    ];
    for (const re of lsdPatterns) {
      const m = text.match(re);
      if (m?.[1]) { out.lsd = m[1]; break; }
    }
  }

  if (!out.uid) {
    const uidPatterns: RegExp[] = [
      /"USER_ID"\s*:\s*"(\d{5,})"/,
      /"actorID"\s*:\s*"(\d{5,})"/,
      /"viewer_id"\s*:\s*"(\d{5,})"/,
      /\bc_user=(\d{5,})/,
      /\b__user=(\d{5,})/,
      /"uid"\s*:\s*"?(\d{5,})/,
    ];
    for (const re of uidPatterns) {
      const m = text.match(re);
      if (m?.[1]) { out.uid = m[1]; break; }
    }
  }

  if (!out.jazoest) {
    const jm = text.match(/\bjazoest=(\d+)/);
    if (jm?.[1]) out.jazoest = jm[1];
  }
  if (!out.jazoest && out.dtsg) {
    out.jazoest = "2" + [...out.dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
  }

  // 4) IDs from URLs
  const actMatch = text.match(/act=(\d{5,})/);
  if (actMatch?.[1]) out.act = actMatch[1];
  const pageMatch =
    text.match(/[?&]page_id=(\d{5,})/) ||
    text.match(/facebook\.com\/(\d{5,})(?:[/?#]|$)/) ||
    text.match(/"page_id"\s*:\s*"?(\d{5,})/);
  if (pageMatch?.[1]) out.pageId = pageMatch[1];
  const bizMatch = text.match(/[?&]business_id=(\d{5,})/) || text.match(/"business_id"\s*:\s*"?(\d{5,})/);
  if (bizMatch?.[1]) out.businessId = bizMatch[1];

  return out;
}

function extractFromHtml(html: string) {
  const parsed = parseAnyInput(html);
  return { dtsg: parsed.dtsg, lsd: parsed.lsd };
}

export const parseInput = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ raw: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => parseAnyInput(data.raw));

export const fetchSessionTokens = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ cookieString: z.string().min(1), uid: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const browserHeaders: Record<string, string> = {
      cookie: data.cookieString,
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "upgrade-insecure-requests": "1",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    };
    const pages = [
      // mbasic serves plain HTML with hidden <input name="fb_dtsg"> — easiest to parse
      "https://mbasic.facebook.com/",
      "https://mbasic.facebook.com/settings",
      "https://m.facebook.com/",
      "https://m.facebook.com/settings",
      "https://www.facebook.com/ads/manager/account_settings/information/",
      "https://www.facebook.com/business_center/",
      "https://www.facebook.com/me",
      "https://www.facebook.com/settings",
      "https://web.facebook.com/settings",
    ];
    let lastLen = 0;
    let lastStatus = 0;
    let redirectedToLogin = false;
    for (const url of pages) {
      try {
        const res = await fetch(url, { headers: browserHeaders, redirect: "follow" });
        lastStatus = res.status;
        if (res.redirected && /login|checkpoint/.test(res.url)) redirectedToLogin = true;
        const html = await res.text();
        lastLen = html.length;
        const { dtsg, lsd } = extractFromHtml(html);
        if (dtsg) {
          const jazoest = "2" + [...dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
          return { success: true, dtsg, lsd, jazoest, error: null };
        }
      } catch {
        /* try next */
      }
    }
    const hint = redirectedToLogin
      ? "فيسبوك حوّل الطلب لصفحة تسجيل الدخول — الكوكيز غير صالحة أو ناقصة (لازم c_user و xs كاملين)."
      : "فيسبوك لم يُرجع الصفحة الكاملة لطلب السيرفر. انسخ fb_dtsg يدوياً: افتح فيسبوك، اضغط F12 ← Console واكتب require('DTSG').getToken() أو الصق مصدر الصفحة (Ctrl+U) هنا.";
    return {
      success: false,
      dtsg: null,
      lsd: null,
      jazoest: null,
      error: `تعذّر استخراج fb_dtsg تلقائياً (HTTP ${lastStatus}، ${lastLen} حرف). ${hint}`,
    };
  });

export const uploadImage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        credentials: credsSchema,
        adAccountId: z.string().min(1),
        fileName: z.string(),
        fileType: z.string(),
        fileBase64: z.string(),
        width: z.number().default(1200),
        height: z.number().default(628),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const c = data.credentials;
    const bytes = Uint8Array.from(atob(data.fileBase64), (ch) => ch.charCodeAt(0));
    const mime = data.fileType || "image/jpeg";
    const actNoPrefix = data.adAccountId.replace(/^act_/, "");

    const extractHash = (parsed: any): string | null => {
      if (!parsed) return null;
      // GraphQL shapes
      const g1 = parsed?.data?.ad_account_upload_image?.image?.image_hash;
      const g2 = parsed?.data?.adAccountUploadImage?.image?.image_hash;
      if (g1) return g1;
      if (g2) return g2;
      // REST /adimages shape: { images: { filename: { hash: "..." } } }
      const imgs = parsed?.images;
      if (imgs && typeof imgs === "object") {
        for (const k of Object.keys(imgs)) {
          const h = imgs[k]?.hash;
          if (h) return h;
        }
      }
      return null;
    };

    const attempts: { name: string; status: number; body: string }[] = [];

    // Attempt 1: GraphQL (current)
    try {
      const form = new FormData();
      const params: Record<string, string> = {
        ...baseParams(c),
        fb_api_req_friendly_name: "LWICometAdAccountUploadImageMutation",
        variables: JSON.stringify({
          input: {
            ad_account_id: data.adAccountId,
            hide_in_ad_image_library: false,
            actor_id: c.uid,
            client_mutation_id: "1",
          },
          imageWidth: data.width,
          imageHeight: data.height,
        }),
        doc_id: "9778970048838259",
      };
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append("file", new Blob([bytes], { type: mime }), data.fileName);
      const res = await fetch("https://www.facebook.com/api/graphql/", {
        method: "POST",
        headers: fbHeaders(c, "LWICometAdAccountUploadImageMutation"),
        body: form,
      });
      const text = await res.text();
      const parsed = parseFbResponse(text);
      const hash = extractHash(parsed);
      if (hash) return { success: true, imageHash: hash, error: null };
      attempts.push({ name: "graphql", status: res.status, body: text.slice(0, 400) });
    } catch (e: any) {
      attempts.push({ name: "graphql", status: 0, body: String(e?.message ?? e) });
    }

    // Attempt 2: REST /act_{id}/adimages  (multipart, cookie-authed)
    try {
      const form = new FormData();
      form.append("fb_dtsg", c.dtsg);
      if (c.jazoest) form.append("jazoest", c.jazoest);
      form.append("__user", c.uid);
      form.append("__a", "1");
      form.append("filename", new Blob([bytes], { type: mime }), data.fileName);
      const res = await fetch(`https://www.facebook.com/api/graph/act_${actNoPrefix}/adimages`, {
        method: "POST",
        headers: fbHeaders(c, "AdsRESTUploadImage"),
        body: form,
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = parseFbResponse(text); }
      const hash = extractHash(parsed);
      if (hash) return { success: true, imageHash: hash, error: null };
      attempts.push({ name: "rest-adimages", status: res.status, body: text.slice(0, 400) });
    } catch (e: any) {
      attempts.push({ name: "rest-adimages", status: 0, body: String(e?.message ?? e) });
    }

    // Attempt 3: legacy ajax endpoint
    try {
      const form = new FormData();
      const params: Record<string, string> = {
        ...baseParams(c),
        act: actNoPrefix,
        source: "9",
      };
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append("images[0]", new Blob([bytes], { type: mime }), data.fileName);
      const res = await fetch(
        `https://www.facebook.com/ajax/ads/adimage/upload.php?act=${actNoPrefix}`,
        { method: "POST", headers: fbHeaders(c, "AdsImageUpload"), body: form },
      );
      const text = await res.text();
      const parsed = parseFbResponse(text) as any;
      const hash =
        extractHash(parsed) ??
        parsed?.payload?.images?.[0]?.hash ??
        parsed?.payload?.hash ??
        null;
      if (hash) return { success: true, imageHash: hash, error: null };
      attempts.push({ name: "legacy-ajax", status: res.status, body: text.slice(0, 400) });
    } catch (e: any) {
      attempts.push({ name: "legacy-ajax", status: 0, body: String(e?.message ?? e) });
    }

    const summary = attempts
      .map((a) => `[${a.name} ${a.status}] ${a.body}`)
      .join(" | ")
      .slice(0, 800);
    return {
      success: false,
      imageHash: null,
      error: `فشلت كل محاولات الرفع. ${summary}`,
    };
  });

export const createAd = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        credentials: credsSchema,
        act: z.string().min(1),
        pageId: z.string().min(1),
        country: z.string(),
        gender: z.enum(["0", "1", "2"]),
        ageMin: z.number(),
        ageMax: z.number(),
        savedAudienceId: z.string().nullable().optional(),
        goal: z.enum(["1", "2", "3", "4"]),
        budget: z.number(),
        continuous: z.boolean(),
        days: z.number(),
        message: z.string(),
        storeName: z.string().nullable().optional(),
        imageHashes: z.array(z.string()).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const c = data.credentials;

    const targetingObj: Record<string, unknown> = {
      genders: data.gender === "0" ? [0] : [Number(data.gender)],
      age_min: data.ageMin,
      age_max: data.ageMax,
      targeting_optimization: "expansion_all",
      targeting_automation: { advantage_audience: 1 },
      user_age_unknown: true,
      geo_locations: { countries: [data.country], location_types: ["home", "recent"] },
    };
    const targetingSpecString = JSON.stringify(targetingObj);
    const audienceOption = data.savedAudienceId ? "SAVED_AUDIENCE" : "AUTO_TARGETING";

    const goalMap: Record<string, [string, unknown, string[]]> = {
      "1": ["POST_ENGAGEMENT", { type: "LIKE_PAGE", value: { page: data.pageId } }, []],
      "2": ["GET_PAGE_LIKES", { type: "LIKE_PAGE", value: { page: data.pageId } }, []],
      "3": [
        "GET_MULTI_MESSAGES",
        { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } },
        ["FACEBOOK", "MESSENGER"],
      ],
      "4": ["GET_WEBSITE_VISITORS", null, []],
    };
    const [adsGoal, ctaObj, publisherPlatforms] = goalMap[data.goal] ?? goalMap["4"]!;

    const link = `https://facebook.com/${data.pageId}`;
    const linkData: Record<string, unknown> = {
      call_to_action: ctaObj,
      link,
      message: data.message,
    };
    if (data.storeName) linkData["name"] = data.storeName;
    if (data.imageHashes.length > 1) {
      linkData["child_attachments"] = data.imageHashes.map((h) => ({
        link,
        image_hash: h,
        name: data.storeName,
      }));
      linkData["multi_share_end_card"] = false;
      linkData["multi_share_optimized"] = true;
    } else {
      linkData["image_hash"] = data.imageHashes[0];
    }

    const creationSpec = {
      ab_test_audiences: [
        {
          audience_option: audienceOption,
          saved_audience_id: data.savedAudienceId ?? null,
          targeting_spec_string: targetingSpecString,
        },
      ],
      ads_lwi_goal: adsGoal,
      audience_option: audienceOption,
      billing_event: "IMPRESSIONS",
      budget: data.budget,
      budget_type: "DAILY_BUDGET",
      currency: "USD",
      duration_in_days: data.continuous ? -1 : data.days,
      impression_id: crypto.randomUUID(),
      legacy_ad_account_id: data.act,
      legacy_entry_point: "business_content_manager_list_view",
      link_data: linkData,
      placement_spec: { publisher_platforms: publisherPlatforms },
      regulated_category: "NONE",
      run_continuously: data.continuous,
      sabr_version: "v1_v2",
      saved_audience_id: data.savedAudienceId ?? null,
      start_time: data.continuous ? null : Math.floor((Date.now() + 3600_000)),
      surface: "BIZ_WEB",
      targeting_spec_string: targetingSpecString,
    };

    const body = new URLSearchParams({
      ...baseParams(c),
      fb_api_req_friendly_name: "useLWICometCreateBoostedComponentMutation",
      variables: JSON.stringify({
        input: {
          creation_spec: creationSpec,
          actor_id: c.uid,
          client_mutation_id: "1",
        },
      }),
      doc_id: "7891234567890123",
    });

    const res = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: { ...fbHeaders(c), "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = parseFbResponse(await res.text()) as any;
    const adId = parsed?.data?.create_boosted_component?.ad?.id ?? null;

    return {
      success: Boolean(adId),
      adId,
      error: adId ? null : JSON.stringify(parsed?.errors ?? parsed).slice(0, 800),
    };
  });
