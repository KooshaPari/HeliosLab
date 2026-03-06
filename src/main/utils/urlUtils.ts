const defaultWebFavicon = "views://assets/file-icons/bookmark.svg";

// mapping of hostname to cached favicon url
const faviconCache: { [url: string]: string } = {};

async function resolveFavicon(hostname: string): Promise<string> {
  const res = await fetch(hostname);
  if (!res.ok) {
    throw new Error("not ok");
  }

  let resolvedFaviconUrl: string | null = null;
  const rewriter = new HTMLRewriter();
  rewriter
    .on(
      "link[rel~='icon'], link[rel~='shortcut'], link[rel~='apple-touch-icon'], meta[itemprop='image']",
      {
        element(faviconLink) {
          if (resolvedFaviconUrl !== null) {
            return;
          }

          const faviconUrl =
            faviconLink.getAttribute("href") ?? faviconLink.getAttribute("content");

          if (faviconUrl === null) {
            return;
          }

          const withFileStripped = faviconUrl.replace("file:///", "");
          resolvedFaviconUrl = withFileStripped.startsWith("http")
            ? withFileStripped
            : `${res.url}${withFileStripped}`;
        },
      },
    )
    .transform(res);

  if (resolvedFaviconUrl === null) {
    throw new Error("no favicon url");
  }

  return resolvedFaviconUrl;
}

export async function getFaviconForUrl(url: string): Promise<string> {
  const hostname = new URL(url).origin;
  const cachedFavicon = faviconCache[hostname];
  if (cachedFavicon !== undefined) {
    return cachedFavicon;
  }

  try {
    const resolvedFaviconUrl = await resolveFavicon(hostname);
    faviconCache[hostname] = resolvedFaviconUrl;
    return resolvedFaviconUrl;
  } catch (_error: unknown) {
    const hostnameParts = hostname.split(".");
    if (hostnameParts.length > 2) {
      const domain = hostnameParts.slice(1).join(".");
      return getFaviconForUrl(`https://${domain}`);
    }
    return defaultWebFavicon;
  }
}
