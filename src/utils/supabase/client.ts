import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const parseCookieValue = (value: string | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const getCookies = () => {
  if (typeof document === "undefined") return [];

  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex === -1) return null;
      const name = cookie.slice(0, separatorIndex).trim();
      const value = parseCookieValue(cookie.slice(separatorIndex + 1));
      return name && value ? { name, value } : null;
    })
    .filter((item): item is { name: string; value: string } => Boolean(item));
};

export const createClient = () =>
  createBrowserClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return getCookies();
      },
      setAll(cookiesToSet) {
        if (typeof document === "undefined") return;

        cookiesToSet.forEach(({ name, value, options }) => {
          const cookieParts = [`${name}=${value}`];
          const path = options?.path ?? "/";
          cookieParts.push(`Path=${path}`);
          if (options?.maxAge) cookieParts.push(`Max-Age=${options.maxAge}`);
          if (options?.sameSite) cookieParts.push(`SameSite=${options.sameSite}`);
          if (options?.secure) cookieParts.push("Secure");
          document.cookie = cookieParts.join(";");
        });
      },
    },
  });
