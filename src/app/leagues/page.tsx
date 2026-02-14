import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";

export default async function LeaguesPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/login");
    }

    const leagues = await prisma.league.findMany({
        where: {
            members: {
                some: {
                    userId: session.user.id,
                },
            },
        },
        orderBy: {
            createdAt: 'desc'
        },
        include: {
            _count: {
                select: { teams: true }
            },
            members: {
                where: {
                    userId: session.user.id
                },
                select: {
                    role: true
                }
            }
        }
    });

    return (
        <div className="container mx-auto py-10 px-4">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Your Leagues</h1>
                    <p className="text-muted-foreground mt-1">Manage existing leagues or create a new one.</p>
                </div>
                <Link href="/leagues/new">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Create League
                    </Button>
                </Link>
            </div>

            {leagues.length === 0 ? (
                <Card className="text-center py-10 bg-muted/20 border-dashed">
                    <CardHeader>
                        <CardTitle>No leagues found</CardTitle>
                        <CardDescription>Get started by creating your first fantasy football league.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/leagues/new">
                            <Button variant="outline">Create New League</Button>
                        </Link>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {leagues.map((league) => (
                        <Link key={league.id} href={`/leagues/${league.id}`} className="block h-full">
                            <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="line-clamp-1">{league.name}</CardTitle>
                                        <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded">
                                            {league.members[0]?.role}
                                        </span>
                                    </div>
                                    <CardDescription>{league.season} Season</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-sm text-muted-foreground">
                                        <div className="flex justify-between mb-2">
                                            <span>Teams</span>
                                            <span>{league._count.teams} / {league.maxTeams}</span>
                                        </div>
                                        {/* Add more details here if needed */}
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
