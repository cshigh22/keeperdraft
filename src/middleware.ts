import { auth } from "@/auth";

export default auth((req) => {
    const isLoggedin = !!req.auth;
    const { nextUrl } = req;

    const isPublicRoute =
        nextUrl.pathname === "/login" ||
        nextUrl.pathname.startsWith("/api/auth") ||
        nextUrl.pathname.startsWith("/join/");

    if (isLoggedin && nextUrl.pathname === "/login") {
        return Response.redirect(new URL("/leagues", nextUrl));
    }

    if (!isLoggedin && !isPublicRoute) {
        return Response.redirect(new URL("/login", nextUrl));
    }

    return;
});

export const config = {
    matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

