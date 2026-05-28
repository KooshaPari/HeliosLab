const defaultWebFavicon = "views://assets/file-icons/bookmark.svg";

// mapping of hostname to cached favicon url
const faviconCache: { [url: string]: string } = {};

export function getFaviconForUrl(url: string): Promise<string> {
  const hostname = new URL(url).origin;

  return new Promise((resolve) => {
    if (faviconCache[hostname]) {
      resolve(faviconCache[hostname]);
      return;
    }

    fetch(hostname)
      .then(async (res) => {
        // fetch will wait for the previous fetch to run, we want it to actually fetch
        // each real domain
        if (!res.ok) {
          throw new Error("not ok");
        }

        const rewriter = new HTMLRewriter();
        // todo: handle this better
        let found = false;
        rewriter
          .on(
            "link[rel~='icon'], link[rel~='shortcut'], link[rel~='apple-touch-icon'], meta[itemprop='image']",
            {
              element(faviconLink) {
                if (found) {
                  return;
                }

                const faviconUrl =
                  faviconLink &&
                  (faviconLink.getAttribute("href") ||
                    faviconLink.getAttribute("content"));

                const withFileStripped = faviconUrl?.replace("file:///", "");
                const fullFaviconUrl = withFileStripped?.startsWith("http")
                  ? withFileStripped
                  : `${res.url}${withFileStripped}`;

                if (!fullFaviconUrl) {
                  throw new Error("no favicon url");
                }

                found = true;
                // todo: right now just storing the url, but we should
                // write the image to disk to an .colab folder for cache
                // and store /return the file path
                // then also cache it on the front-end
                faviconCache[hostname] = fullFaviconUrl;
                resolve(fullFaviconUrl);
              },
            }
          )
          .transform(res);
      })

      // just catch it silently
      .catch((error: any) => {
        // if the subdomain doesn't have a favicon or fails for some other reason, try the domain
        const hostnameParts = hostname.split(".");
        if (hostnameParts.length > 2) {
          const domain = hostnameParts.slice(1).join(".");

          getFaviconForUrl(`https://${domain}`)
            .then((fullFaviconUrl) => {
              resolve(fullFaviconUrl);
            })
            .catch(() => {
              resolve(defaultWebFavicon);
            });
        } else {
          resolve(defaultWebFavicon);
        }
      });
  });
}
