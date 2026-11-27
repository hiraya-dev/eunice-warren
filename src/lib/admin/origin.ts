export const isSameOriginPost = (request: Request, url: URL): boolean =>
  request.headers.get("origin") === url.origin;
