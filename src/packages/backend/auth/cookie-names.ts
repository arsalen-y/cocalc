/*
We prefix the cookie with the base path so that it's possible to
have multiple distinct cocalc servers running on the same domain
without them colliding when doing development.  However, this doesn't
help with multiple cocalc's on the same server with the same base
path serving on distinct ports.  In that case, you can explicitly
set the remember me cookie name to whatever you want by
setting the following environment variable:

- COCALC_REMEMBER_ME_COOKIE_NAME -- env variable for arbitrary remember_me cookie name
- COCALC_API_COOKIE_NAME -- similar for the api cookie name.
*/

import basePath from "@cocalc/backend/base-path";

// Name of user provided remember_me cookie -- this is http-only and gets set
// when the user is signed in.
export const REMEMBER_ME_COOKIE_NAME = process.env.COCALC_REMEMBER_ME_COOKIE_NAME ?? `${
  basePath.length <= 1 ? "" : encodeURIComponent(basePath)
}remember_me`;

// Name of user provided api key cookie, with appropriate base path.
// This is set by the user when using the api from node.js, especially
// via a websocket.
export const API_COOKIE_NAME = process.env.COCALC_API_COOKIE_NAME ?? `${
  basePath.length <= 1 ? "" : encodeURIComponent(basePath)
}api_key`;
