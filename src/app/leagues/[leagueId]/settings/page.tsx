import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import LeagueSettingsForm from "./LeagueSettingsForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function LeagueSettingsPage({
    params,
}: {
    params: { leagueId: string };
}) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect("/login");
    }

    const league = await prisma.league.findUnique({
        where: { id: params.leagueId },
        include: {
            draftSettings: true,
            draftState: true,
        },
    });

    if (!league) {
        notFound();
    }

    if (league.commissionerId !== session.user.id) {
        redirect(`/leagues/${league.id}`);
    }

    return (
        <div className="container mx-auto py-10 px-4">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={`/leagues/${league.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight">League Settings</h1>
                </div>

                <LeagueSettingsForm league={league} />
            </div>
        </div>
    );
}
