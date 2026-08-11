import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";

// Dev-only sign-in bypass. Two independent gates must both hold:
// `next dev` is the only thing that sets NODE_ENV=development, and
// ENABLE_DEV_LOGIN lives in .env.local — never in deployed env vars.
export const devLoginEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_DEV_LOGIN === "true";

const providers: Provider[] = [
    Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
];

if (devLoginEnabled) {
    providers.push(
        Credentials({
            id: "dev-login",
            name: "Dev Login",
            credentials: { email: {} },
            async authorize(credentials) {
                // Re-check the gate so this can never authorize in production,
                // even if the registration guard above is ever refactored away.
                if (
                    process.env.NODE_ENV === "production" ||
                    process.env.ENABLE_DEV_LOGIN !== "true"
                ) {
                    throw new Error("Dev login is disabled");
                }
                const email =
                    typeof credentials?.email === "string" ? credentials.email : "";
                // Seeded demo accounts only — never real users.
                if (!email.endsWith("@demo.com")) return null;
                return prisma.user.findUnique({ where: { email } });
            },
        })
    );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: PrismaAdapter(prisma),
    session: { strategy: "jwt" },
    trustHost: true,
    providers,
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user && token.id) {
                session.user.id = token.id as string;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
});
