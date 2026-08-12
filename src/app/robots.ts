import type { MetadataRoute } from "next";

/** The public pages are indexable; everything behind sign-in is not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/submit"],
      disallow: ["/dashboard", "/dashboard/", "/api/", "/signin", "/status"],
    },
  };
}
