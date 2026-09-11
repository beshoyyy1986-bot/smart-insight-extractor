import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { createAd, fetchSessionTokens, parseInput, uploadImage } from "@/lib/fb.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JAMAIKA Meta Ads Pro — لوحة إدارة إعلانات ميتا" },
      {
        name: "description",
        content:
          "أداة عربية لاستيراد بيانات الحساب، رفع الصور، وإنشاء إعلانات فيسبوك وإنستجرام من مكان واحد.",
      },
      { property: "og:title", content: "JAMAIKA Meta Ads Pro" },
      {
        property: "og:description",
        content: "استورد بياناتك، ارفع صورك، وأنشئ إعلاناتك على ميتا بواجهة عربية بسيطة.",
      },
    ],
  }),
  component: Index,
});

type Creds = {
  uid: string;
  dtsg: string;
  jazoest?: string | null;
  lsd?: string | null;
  cookieString: string;
};

type Ids = { act: string; page_id: string; business_id: string };

const COUNTRIES: Record<string, string> = {
  EG: "مصر 🇪🇬",
  SA: "السعودية 🇸🇦",
  AE: "الإمارات 🇦🇪",
  KW: "الكويت 🇰🇼",
  QA: "قطر 🇶🇦",
  BH: "البحرين 🇧🇭",
  OM: "عُمان 🇴🇲",
  IQ: "العراق 🇮🇶",
  JO: "الأردن 🇯🇴",
  LB: "لبنان 🇱🇧",
  MA: "المغرب 🇲🇦",
  DZ: "الجزائر 🇩🇿",
  TN: "تونس 🇹🇳",
  LY: "ليبيا 🇱🇾",
  SD: "السودان 🇸🇩",
};

const GOALS: Record<string, string> = {
  "1": "تفاعل المنشور",
  "2": "إعجابات الصفحة",
  "3": "رسائل",
  "4": "زيارات الموقع",
};

const TABS = [
  { id: "data", label: "📊 البيانات" },
  { id: "images", label: "🖼️ الصور" },
  { id: "ad", label: "🎯 إنشاء إعلان" },
  { id: "stats", label: "📈 الإحصائيات" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Index() {
  const [cookieInput, setCookieInput] = useState("");
  const [creds, setCreds] = useState<Creds | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const [ids, setIds] = useState<Ids>({ act: "", page_id: "", business_id: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>("data");
  const fileRef = useRef<HTMLInputElement>(null);

  const [country, setCountry] = useState("EG");
  const [gender, setGender] = useState<"0" | "1" | "2">("0");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [savedAudienceId, setSavedAudienceId] = useState("");
  const [goal, setGoal] = useState<"1" | "2" | "3" | "4">("1");
  const [budget, setBudget] = useState(10);
  const [continuous, setContinuous] = useState(false);
  const [days, setDays] = useState(7);
  const [message, setMessage] = useState("");
  const [storeName, setStoreName] = useState("");
  const [adId, setAdId] = useState<string | null>(null);

  const doUpload = useServerFn(uploadImage);
  const doCreate = useServerFn(createAd);
  const doFetchTokens = useServerFn(fetchSessionTokens);

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files],
  );

  async function importCookies() {
    const raw = cookieInput.trim();
    // Normalize: accept ; or , or newlines as separators
    const normalized = raw.replace(/[\r\n]+/g, ";").replace(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/g, ";");
    const map: Record<string, string> = {};
    for (const part of normalized.split(";")) {
      const t = part.trim();
      if (!t) continue;
      const i = t.indexOf("=");
      if (i > 0) {
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim();
        if (k && v) map[k] = v;
      }
    }
    const uid = map["c_user"];
    if (!uid) {
      setNotice({ kind: "err", text: "لم نجد c_user داخل الكوكيز — تأكد من نسخها كاملة." });
      return;
    }
    // rebuild a clean cookie string with essential keys first
    const essential = ["c_user", "xs", "fr", "datr", "sb", "dpr", "wd", "locale", "presence", "ps_l", "ps_n"];
    const parts: string[] = [];
    for (const k of essential) if (map[k]) parts.push(`${k}=${map[k]}`);
    for (const [k, v] of Object.entries(map)) if (!essential.includes(k)) parts.push(`${k}=${v}`);
    const cookieString = parts.join("; ");

    let dtsg = map["fb_dtsg"] ?? map["dtsg"] ?? "";
    let lsd = map["lsd"] ?? null;
    let jazoest: string | null = dtsg
      ? "2" + [...dtsg].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString()
      : null;

    setNotice({ kind: "warn", text: "جارٍ استخراج fb_dtsg من الجلسة..." });
    try {
      const r = await doFetchTokens({ data: { cookieString, uid } });
      if (r.success && r.dtsg) {
        dtsg = r.dtsg;
        lsd = r.lsd ?? lsd;
        jazoest = r.jazoest ?? jazoest;
      }
    } catch {
      /* fallback below */
    }

    setCreds({ uid, dtsg, jazoest, lsd, cookieString });
    if (dtsg) {
      setNotice({ kind: "ok", text: `تم الاستيراد بنجاح — UID: ${uid} — fb_dtsg مستخرج تلقائياً ✓` });
    } else {
      setNotice({ kind: "warn", text: "تعذّر استخراج fb_dtsg تلقائياً — أضفه يدوياً بالأسفل أو تحقق من صلاحية الكوكيز." });
    }
  }

  function setDtsg(v: string) {
    if (!creds || !v) return;
    const jazoest = "2" + [...v].reduce((s, ch) => s + ch.charCodeAt(0), 0).toString();
    setCreds({ ...creds, dtsg: v, jazoest });
    setNotice({ kind: "ok", text: "تم تحديث fb_dtsg" });
  }

  async function toBase64(file: File) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  async function uploadAll() {
    if (!creds || !ids.act) return;
    setBusy(true);
    setNotice(null);
    const out: string[] = [];
    try {
      for (const f of files) {
        const res = await doUpload({
          data: {
            credentials: creds,
            adAccountId: ids.act,
            fileName: f.name,
            fileType: f.type,
            fileBase64: await toBase64(f),
            width: 1200,
            height: 628,
          },
        });
        if (res.success && res.imageHash) out.push(res.imageHash);
        else setNotice({ kind: "err", text: `فشل رفع ${f.name}: ${res.error}` });
      }
      setHashes(out);
      if (out.length) setNotice({ kind: "ok", text: `تم رفع ${out.length} صورة بنجاح` });
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submitAd() {
    if (!creds) return;
    setBusy(true);
    setNotice(null);
    setAdId(null);
    try {
      const res = await doCreate({
        data: {
          credentials: creds,
          act: ids.act,
          pageId: ids.page_id,
          country,
          gender,
          ageMin,
          ageMax,
          savedAudienceId: savedAudienceId || null,
          goal,
          budget,
          continuous,
          days: continuous ? -1 : days,
          message,
          storeName: storeName || null,
          imageHashes: hashes,
        },
      });
      if (res.success) {
        setAdId(res.adId);
        setNotice({ kind: "ok", text: "تم إنشاء الإعلان بنجاح" });
      } else {
        setNotice({ kind: "err", text: `فشل إنشاء الإعلان: ${res.error}` });
      }
    } catch (e) {
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const noticeClass =
    notice?.kind === "ok"
      ? "border-success/40 bg-success/10 text-success"
      : notice?.kind === "warn"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-destructive/40 bg-destructive/10 text-destructive";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="font-display text-2xl font-black tracking-tight">
              🚀 JAMAIKA <span className="text-primary">Meta Ads Pro</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              لوحة عربية لإدارة إعلانات فيسبوك وإنستجرام
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              creds ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {creds ? `متصل • ${creds.uid}` : "غير متصل"}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[340px_1fr]">
        <aside className="panel h-fit space-y-4 p-5">
          <h2 className="font-display text-lg font-bold">⚙️ الإعدادات</h2>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-primary">🔐 Cookie String</h3>
            <p className="text-xs leading-6 text-muted-foreground">
              افتح فيسبوك في المتصفح، ثم F12 ← Application ← Cookies، وانسخ الكوكيز بصيغة
              <code className="mx-1 rounded bg-input px-1">name=value; name2=value2</code>
            </p>
            <textarea
              className="field h-32 resize-none font-mono text-xs"
              dir="ltr"
              placeholder="c_user=123456789; xs=token; datr=value; ..."
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
            />
            <button className="btn-primary w-full" onClick={importCookies}>
              🚀 استيراد Cookies
            </button>
          </div>

          {creds && (
            <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">UID</span>
                <span dir="ltr" className="font-mono">
                  {creds.uid}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">DTSG</span>
                <span dir="ltr" className="truncate font-mono">
                  {creds.dtsg ? creds.dtsg.slice(0, 18) + "…" : "غير متوفر"}
                </span>
              </div>
              <Field label="إدخال fb_dtsg يدوياً">
                <input
                  className="field font-mono text-xs"
                  dir="ltr"
                  placeholder="DTSG token"
                  onBlur={(e) => setDtsg(e.target.value.trim())}
                />
              </Field>
              <button
                className="btn-ghost w-full"
                onClick={() => {
                  setCreds(null);
                  setHashes([]);
                  setNotice(null);
                }}
              >
                تسجيل الخروج
              </button>
            </div>
          )}
        </aside>

        <section className="space-y-4">
          {notice && (
            <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${noticeClass}`}>
              {notice.text}
            </div>
          )}

          {!creds ? (
            <div className="panel p-10 text-center">
              <p className="text-lg font-bold">⚠️ يرجى استيراد الكوكيز للبدء</p>
              <p className="mt-2 text-sm text-muted-foreground">
                استخدم القائمة الجانبية لإضافة بيانات حسابك.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                      tab === t.id
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "data" && (
                <div className="panel space-y-4 p-5">
                  <h2 className="font-display text-lg font-bold">📊 معرفات الحساب</h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Ad Account ID">
                      <input
                        className="field font-mono"
                        dir="ltr"
                        placeholder="123456789"
                        value={ids.act}
                        onChange={(e) => setIds({ ...ids, act: e.target.value.trim() })}
                      />
                    </Field>
                    <Field label="Page ID">
                      <input
                        className="field font-mono"
                        dir="ltr"
                        placeholder="123456789"
                        value={ids.page_id}
                        onChange={(e) => setIds({ ...ids, page_id: e.target.value.trim() })}
                      />
                    </Field>
                    <Field label="Business ID (اختياري)">
                      <input
                        className="field font-mono"
                        dir="ltr"
                        placeholder="123456789"
                        value={ids.business_id}
                        onChange={(e) => setIds({ ...ids, business_id: e.target.value.trim() })}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    تجدها في رابط مدير الإعلانات بعد <code className="font-mono">act=</code> ورابط
                    صفحتك.
                  </p>
                </div>
              )}

              {tab === "images" && (
                <div className="panel space-y-4 p-5">
                  <h2 className="font-display text-lg font-bold">🖼️ رفع الصور</h2>
                  {!ids.act ? (
                    <p className="text-sm text-warning">⚠️ أدخل Ad Account ID أولاً.</p>
                  ) : (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        multiple
                        className="hidden"
                        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                      />
                      <div className="flex flex-wrap gap-3">
                        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
                          اختر صوراً
                        </button>
                        <button
                          className="btn-primary"
                          disabled={!files.length || busy}
                          onClick={uploadAll}
                        >
                          {busy ? "جاري الرفع…" : `رفع ${files.length || ""} صورة`}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {previews.map((p) => (
                          <img
                            key={p.url}
                            src={p.url}
                            alt={p.name}
                            className="aspect-video w-full rounded-lg border border-border object-cover"
                          />
                        ))}
                      </div>
                      {hashes.length > 0 && (
                        <div className="space-y-1 rounded-lg border border-border bg-surface p-3">
                          <p className="text-sm font-bold text-success">
                            تم رفع {hashes.length} صورة
                          </p>
                          {hashes.map((h, i) => (
                            <p key={h} dir="ltr" className="font-mono text-xs text-muted-foreground">
                              #{i + 1} {h}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === "ad" && (
                <div className="panel space-y-5 p-5">
                  <h2 className="font-display text-lg font-bold">🎯 إنشاء إعلان</h2>
                  {!ids.page_id && <p className="text-sm text-warning">⚠️ أدخل Page ID أولاً.</p>}
                  {!hashes.length && <p className="text-sm text-warning">⚠️ ارفع صورة أولاً.</p>}

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary">الاستهداف</h3>
                      <Field label="الدولة">
                        <select
                          className="field"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        >
                          {Object.entries(COUNTRIES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="الجنس">
                        <select
                          className="field"
                          value={gender}
                          onChange={(e) => setGender(e.target.value as "0" | "1" | "2")}
                        >
                          <option value="0">الكل</option>
                          <option value="1">ذكور</option>
                          <option value="2">إناث</option>
                        </select>
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="أقل عمر">
                          <input
                            type="number"
                            min={18}
                            max={65}
                            className="field"
                            value={ageMin}
                            onChange={(e) => setAgeMin(Number(e.target.value))}
                          />
                        </Field>
                        <Field label="أكبر عمر">
                          <input
                            type="number"
                            min={18}
                            max={65}
                            className="field"
                            value={ageMax}
                            onChange={(e) => setAgeMax(Number(e.target.value))}
                          />
                        </Field>
                      </div>
                      <Field label="معرف الجمهور المحفوظ (اختياري)">
                        <input
                          className="field font-mono"
                          dir="ltr"
                          value={savedAudienceId}
                          onChange={(e) => setSavedAudienceId(e.target.value.trim())}
                        />
                      </Field>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary">إعدادات الإعلان</h3>
                      <Field label="هدف الإعلان">
                        <select
                          className="field"
                          value={goal}
                          onChange={(e) => setGoal(e.target.value as "1" | "2" | "3" | "4")}
                        >
                          {Object.entries(GOALS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="الميزانية اليومية ($)">
                        <input
                          type="number"
                          min={1}
                          step={0.5}
                          className="field"
                          value={budget}
                          onChange={(e) => setBudget(Number(e.target.value))}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-primary)]"
                          checked={continuous}
                          onChange={(e) => setContinuous(e.target.checked)}
                        />
                        تشغيل مستمر
                      </label>
                      {!continuous && (
                        <Field label="عدد الأيام">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            className="field"
                            value={days}
                            onChange={(e) => setDays(Number(e.target.value))}
                          />
                        </Field>
                      )}
                      <Field label="اسم المتجر (اختياري)">
                        <input
                          className="field"
                          value={storeName}
                          onChange={(e) => setStoreName(e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>

                  <Field label="نص الإعلان">
                    <textarea
                      className="field h-28 resize-none"
                      placeholder="اكتب نص الإعلان هنا…"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </Field>

                  <button
                    className="btn-primary w-full"
                    disabled={busy || !ids.page_id || !hashes.length}
                    onClick={submitAd}
                  >
                    {busy ? "جاري الإنشاء…" : "🚀 إنشاء الإعلان"}
                  </button>
                  {adId && (
                    <p dir="ltr" className="text-center font-mono text-sm text-success">
                      Ad ID: {adId}
                    </p>
                  )}
                </div>
              )}

              {tab === "stats" && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "حالة الاتصال", value: creds ? "متصل ✅" : "غير متصل ❌" },
                    { label: "الحسابات الإعلانية", value: ids.act ? "1" : "0" },
                    { label: "الصور المرفوعة", value: String(hashes.length) },
                    { label: "الإعلانات المنشأة", value: adId ? "1" : "0" },
                  ].map((m) => (
                    <div key={m.label} className="panel p-5">
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="mt-2 font-display text-2xl font-black text-primary">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-border/70 py-6 text-center text-xs text-muted-foreground">
        JAMAIKA Meta Ads Pro — استخدم هذه الأداة بمسؤولية
      </footer>
    </div>
  );
}
