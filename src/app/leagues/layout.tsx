
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { LogOut, Trophy } from "lucide-react";

export default async function LeaguesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center justify-between px-4">
                    <Link href="/leagues" className="flex items-center gap-2 font-bold text-xl">
                        <Trophy className="h-6 w-6 text-primary" />
                        <span>KeeperDraft</span>
                    </Link>

                    <div className="flex items-center gap-4">
                        {session?.user && (
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-muted-foreground hidden md:inline-block">
                                    {session.user.email}
                                </span>
                                <form
                                    action={async () => {
                                        "use server";
                                        await signOut();
                                    }}
                                >
                                    <Button variant="ghost" size="icon" title="Sign Out">
                                        <LogOut className="h-5 w-5" />
                                        <span className="sr-only">Sign Out</span>
                                    </Button>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            </header>
            <main>
                {children}
            </main>
        </div>
    );
}
