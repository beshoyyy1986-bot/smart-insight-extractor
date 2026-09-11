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

function fbHeaders(c: Creds) {
  return {
    cookie: c.cookieString,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "x-fb-lsd": c.lsd ?? "",
    origin: "https://www.facebook.com",
    referer: "https://www.facebook.com/",
  };
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

function extractFromHtml(html: string) {
  let dtsg: string | null = null;
  let lsd: string | null = null;

  // 1) JSON token patterns
  const patterns: RegExp[] = [
    /"dtsg"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/,
    /"token"\s*:\s*"(NAc[^"\\]{10,})"/,
    /\\"dtsg\\":\{\\"token\\":\\"([^"\\]+)\\"/,
    /fb_dtsg[^"']{0,20}["']value["']?\s*[:,]\s*["']([^"']+)["']/,
    /name="fb_dtsg"[^>]*value="([^"]+)"/,
    /DTSGInitialData[^}]*"token"\s*:\s*"([^"]+)"/,
    /"dtsg_token"\s*:\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) { dtsg = m[1].replace(/\\\//g, "/"); break; }
  }

  const lsdPatterns: RegExp[] = [
    /"LSD"\s*:\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/,
    /\\"LSD\\",\[\],\{\\"token\\":\\"([^"\\]+)\\"/,
    /name="lsd"[^>]*value="([^"]+)"/,
    /"lsd"\s*:\s*\{"token"\s*:\s*"([^"]+)"/,
  ];
  for (const re of lsdPatterns) {
    const m = html.match(re);
    if (m?.[1]) { lsd = m[1].replace(/\\\//g, "/"); break; }
  }

  return { dtsg, lsd };
}

export const fetchSessionTokens = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ cookieString: z.string().min(1), uid: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const pages = [
      "https://www.facebook.com/",
      "https://m.facebook.com/",
      "https://web.facebook.com/settings",
    ];
    for (const url of pages) {
      try {
        const res = await fetch(url, {
          headers: {
            cookie: data.cookieString,
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "accept-language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });
        const html = await res.text();
        const { dtsg, lsd } = extractFromHtml(html);
        if (dtsg) {
          const jazoest =
            "2" + [...dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
          return { success: true, dtsg, lsd, jazoest, error: null };
        }
      } catch {
        /* try next page */
      }
    }
    return { success: false, dtsg: null, lsd: null, jazoest: null, error: "تعذّر استخراج fb_dtsg تلقائياً — تأكد من أن الجلسة نشطة." };
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

    const form = new FormData();
    const params = {
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
    form.append("file", new Blob([bytes], { type: data.fileType || "image/jpeg" }), data.fileName);

    const res = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: fbHeaders(c),
      body: form,
    });
    const parsed = parseFbResponse(await res.text()) as any;
    const imageHash =
      parsed?.data?.ad_account_upload_image?.image?.image_hash ?? null;

    return {
      success: Boolean(imageHash),
      imageHash,
      error: imageHash ? null : (JSON.stringify(parsed?.errors ?? parsed).slice(0, 600) || "لم يتم إرجاع image_hash"),
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
