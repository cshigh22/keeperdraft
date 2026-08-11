import React from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Users, Settings, Trophy, Play, ArrowLeft, ArrowLeftRight, History } from "lucide-react";
import { InviteLinkButton } from "@/components/league/InviteLinkButton";
import { ProposeTradeButton } from "@/components/trade/ProposeTradeButton";
import { CommissionerTradeButton } from "@/components/trade/CommissionerTradeButton";
import type { TeamSummary, PlayerSummary, DraftPickSummary } from "@/types/socket";
import StartNewSeasonButton from "./StartNewSeasonButton";
import { EditableTeamName } from "@/components/league/EditableTeamName";
import { LegacyVault } from "@/components/champions/LegacyVault";
import { Marketplace } from "@/components/marketplace/Marketplace";
import type { PastWinnerData, KeeperHighlight } from "@/types/champions";
import type { TradeBlockPlayerData, GeneralRosterPlayer } from "@/types/marketplace";

export const dynamic = "force-dynamic";

export default async function LeagueDetailPage({
    params,
}: {
    params: { leagueId: string };
}) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect("/login");
    }

    // ========================================================================
    // DATA FETCHING
    // ========================================================================

    const league = await prisma.league.findUnique({
        where: { id: params.leagueId },
        include: {
            draftSettings: true,
            draftState: true,
            teams: {
                orderBy: { draftPosition: "asc" },
                include: {
                    owner: {
                        select: { name: true, email: true, image: true },
                    },
                    players: {
                        include: {
                            player: {
                                select: {
                                    id: true,
                                    sleeperId: true,
                                    fullName: true,
                                    position: true,
                                    nflTeam: true,
                                    rank: true,
                                },
                            },
                        },
                    },
                },
            },
            members: {
                include: {
                    user: {
                        select: { name: true, email: true },
                    },
                },
            },
            // Hall of Champions data
            pastWinners: {
                orderBy: { season: "desc" },
            },
        },
    });

    if (!league) {
        notFound();
    }

    // Check if user is a member
    const membership = league.members.find(
        (m) => m.userId === session.user!.id
    );
    if (!membership) {
        notFound();
    }

    const isCommissioner = league.commissionerId === session.user.id;
    const filledTeams = league.teams.filter((t) => t.ownerId !== null);
    const draftStatus = league.draftState?.status ?? "NOT_STARTED";

    // Find user's team in this league
    const myTeam = league.teams.find((t) => t.ownerId === session.user!.id);
    const myTeamId = myTeam?.id ?? null;

    // ========================================================================
    // TRADE BLOCK DATA
    // ========================================================================

    const tradeBlockEntries = await prisma.tradeBlockEntry.findMany({
        where: { leagueId: params.leagueId, phase: 'PRE_DRAFT' },
        include: {
            player: {
                select: {
                    id: true,
                    fullName: true,
                    position: true,
                    nflTeam: true,
                    rank: true,
                    adp: true,
                    avatarUrl: true,
                },
            },
            team: {
                select: {
                    id: true,
                    name: true,
                    tradeIntent: true,
                    owner: {
                        select: { name: true },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    // ========================================================================
    // LEAGUE ROSTERS (for the marketplace tabs)
    // ========================================================================

    const blockedPlayerIdsByTeam = new Map<string, Set<string>>();
    for (const entry of tradeBlockEntries) {
        const blockedIds = blockedPlayerIdsByTeam.get(entry.teamId) ?? new Set<string>();
        blockedIds.add(entry.playerId!);
        blockedPlayerIdsByTeam.set(entry.teamId, blockedIds);
    }

    const allLeagueRosters: GeneralRosterPlayer[] = league.teams.flatMap((team) => {
        const teamBlockedIds = blockedPlayerIdsByTeam.get(team.id) ?? new Set<string>();
        return team.players.map((entry) => ({
            id: entry.player.id,
            entryId: entry.id,
            fullName: entry.player.fullName,
            position: entry.player.position,
            nflTeam: entry.player.nflTeam,
            rank: entry.player.rank,
            isKeeper: entry.isKeeper,
            isOnBlock: teamBlockedIds.has(entry.player.id),
            draftCost: entry.keeperRound ?? null,
            teamId: team.id,
            teamName: team.name,
        }));
    });

    // My team's roster for the "My Status" tab is just my slice of the league rosters
    const myPlayers = myTeamId
        ? allLeagueRosters.filter((player) => player.teamId === myTeamId)
        : [];

    // ========================================================================
    // TRADE PROPOSAL DATA (mirrors the draft room's socket state shapes)
    // ========================================================================

    // gte: include future-season picks acquired via trade, not just this board
    const draftPicks = await prisma.draftPick.findMany({
        where: { leagueId: params.leagueId, season: { gte: league.season } },
        include: {
            currentOwner: { include: { owner: { select: { name: true } } } },
        },
        orderBy: [{ season: "asc" }, { overallPickNumber: "asc" }],
    });

    const pickSummaries: DraftPickSummary[] = draftPicks.map((pick) => ({
        id: pick.id,
        season: pick.season,
        round: pick.round,
        pickInRound: pick.pickInRound ?? 0,
        overallPickNumber: pick.overallPickNumber ?? 0,
        currentOwnerId: pick.currentOwnerId,
        currentOwnerName: pick.currentOwner.owner?.name || "Open Slot",
        originalOwnerId: pick.originalOwnerId,
        isComplete: pick.isComplete,
        isKeeper: pick.isKeeper,
    }));

    const teamSummaries: TeamSummary[] = league.teams.map((t) => ({
        id: t.id,
        name: t.name,
        ownerId: t.ownerId,
        ownerName: t.owner?.name || t.owner?.email || "Open Slot",
        draftPosition: t.draftPosition ?? 0,
    }));

    const socketRosters: Record<string, PlayerSummary[]> = Object.fromEntries(
        league.teams.map((t) => [
            t.id,
            t.players.map((entry) => ({
                id: entry.player.id,
                sleeperId: entry.player.sleeperId,
                fullName: entry.player.fullName,
                position: entry.player.position,
                nflTeam: entry.player.nflTeam,
                rank: entry.player.rank,
            })),
        ])
    );

    const myTeamSummary = myTeamId
        ? teamSummaries.find((t) => t.id === myTeamId) ?? null
        : null;

    // ========================================================================
    // SERIALIZE DATA FOR CLIENT COMPONENTS
    // ========================================================================

    const pastWinnersData: PastWinnerData[] = league.pastWinners.map((w) => ({
        id: w.id,
        leagueId: w.leagueId,
        season: w.season,
        managerName: w.managerName,
        teamName: w.teamName,
        keeperHighlights: (w.keeperHighlights as KeeperHighlight[] | null) ?? null,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
    }));

    const tradeBlockData: TradeBlockPlayerData[] = tradeBlockEntries.map((e) => ({
        id: e.id,
        teamId: e.teamId,
        leagueId: e.leagueId,
        playerId: e.playerId,
        draftCost: e.draftCost,
        askingPrice: e.askingPrice,
        phase: e.phase,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
        player: e.player
            ? {
                  id: e.player.id,
                  fullName: e.player.fullName,
                  position: e.player.position,
                  nflTeam: e.player.nflTeam,
                  rank: e.player.rank,
                  adp: e.player.adp,
                  avatarUrl: e.player.avatarUrl,
              }
            : null,
        team: {
            id: e.team.id,
            name: e.team.name,
            tradeIntent: e.team.tradeIntent,
            owner: e.team.owner,
        },
    }));

    const totalRounds = league.draftSettings?.totalRounds ?? 14;
    const totalPlayers = league.maxTeams * totalRounds;

    // Draft room entry button per status (none for CANCELLED)
    const draftAction =
        draftStatus === "NOT_STARTED"
            ? {
                  label: isCommissioner ? "Go to Draft Room" : "Enter Draft Room",
                  variant: "default" as const,
                  icon: Play,
              }
            : draftStatus === "IN_PROGRESS" || draftStatus === "PAUSED"
              ? { label: "Join Draft", variant: "default" as const, icon: Play }
              : draftStatus === "COMPLETED"
                ? { label: "View Draft Results", variant: "outline" as const, icon: Trophy }
                : null;

    const settingsRows: [string, string | number][] = league.draftSettings
        ? [
              ["Draft Type", league.draftSettings.draftType],
              ["Total Rounds", league.draftSettings.totalRounds],
              ["Max Keepers", league.draftSettings.maxKeepers],
              ["Timer", `${league.draftSettings.timerDurationSeconds}s`],
          ]
        : [];

    const rosterSlots: [string, number][] = league.draftSettings
        ? [
              ["QB", league.draftSettings.qbCount],
              ["RB", league.draftSettings.rbCount],
              ["WR", league.draftSettings.wrCount],
              ["TE", league.draftSettings.teCount],
              ["FLEX", league.draftSettings.flexCount],
              ["SFLEX", league.draftSettings.superflexCount],
              ["K", league.draftSettings.kCount],
              ["DEF", league.draftSettings.defCount],
              ["BN", league.draftSettings.benchCount],
          ]
        : [];

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <div className="container mx-auto py-10 px-4">
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <Link href="/leagues" className="text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight">{league.name}</h1>
                        <Badge variant={draftStatus === "COMPLETED" ? "default" : "secondary"}>
                            {draftStatus.replace("_", " ")}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">
                        {league.season} Season &middot; {filledTeams.length}/{league.maxTeams} teams filled
                    </p>
                </div>
                {isCommissioner && <InviteLinkButton leagueId={league.id} />}
            </div>

            <Separator className="my-6" />

            {/* ================================================================
                HALL OF CHAMPIONS
                ================================================================ */}
            <LegacyVault
                leagueId={league.id}
                pastWinners={pastWinnersData}
                isCommissioner={isCommissioner}
            />

            {/* Actions */}
            <div className="flex flex-wrap gap-3 mb-8">
                {draftAction && (
                    <Link href={`/draft?leagueId=${league.id}`}>
                        <Button variant={draftAction.variant}>
                            <draftAction.icon className="mr-2 h-4 w-4" />
                            {draftAction.label}
                        </Button>
                    </Link>
                )}
                {myTeamSummary && (
                    <ProposeTradeButton
                        leagueId={league.id}
                        myTeam={myTeamSummary}
                        allTeams={teamSummaries}
                        myPlayers={socketRosters[myTeamSummary.id] || []}
                        allPicks={pickSummaries}
                        teamRosters={socketRosters}
                        totalRounds={totalRounds}
                        leagueSeason={league.season}
                    />
                )}
                {(myTeamId || isCommissioner) && (
                    <Link href={`/leagues/${league.id}/keepers`}>
                        <Button variant="outline">
                            <Trophy className="mr-2 h-4 w-4" />
                            Keeper Selection
                        </Button>
                    </Link>
                )}
                <Link href={`/leagues/${league.id}/history`}>
                    <Button variant="outline">
                        <History className="mr-2 h-4 w-4" />
                        Past Seasons
                    </Button>
                </Link>
                <Link href={`/leagues/${league.id}/trades`}>
                    <Button variant="outline">
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        Trade History
                    </Button>
                </Link>
                {isCommissioner && (
                    <>
                        <CommissionerTradeButton
                            leagueId={league.id}
                            allTeams={teamSummaries}
                            allPicks={pickSummaries}
                            teamRosters={socketRosters}
                            totalRounds={totalRounds}
                            leagueSeason={league.season}
                        />
                        <Link href={`/leagues/${league.id}/settings`}>
                            <Button variant="outline">
                                <Settings className="mr-2 h-4 w-4" />
                                League Settings
                            </Button>
                        </Link>
                        {draftStatus === "COMPLETED" && (
                            <StartNewSeasonButton
                                leagueId={league.id}
                                leagueName={league.name}
                                currentSeason={league.season}
                            />
                        )}
                    </>
                )}
            </div>

            {/* ================================================================
                TRADE BLOCK 2.0
                ================================================================ */}
            <Marketplace
                leagueId={league.id}
                myTeamId={myTeamId}
                tradeBlockEntries={tradeBlockData}
                myPlayers={myPlayers}
                leagueRosters={allLeagueRosters}
                isCommissioner={isCommissioner}
                totalRounds={totalRounds}
                totalPlayers={totalPlayers}
            />

            <div className="mt-8 grid gap-6 md:grid-cols-2">
                {/* Teams */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Teams
                        </CardTitle>
                        <CardDescription>
                            {filledTeams.length} of {league.maxTeams} slots filled
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {/* Capped so large leagues don't stretch the page; scrolls internally */}
                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                            {league.teams.map((team) => (
                                <div
                                    key={team.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                            {team.draftPosition}
                                        </div>
                                        <div>
                                            <EditableTeamName
                                                teamId={team.id}
                                                leagueId={league.id}
                                                initialName={team.name}
                                                isEditable={team.ownerId === session.user!.id || isCommissioner}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                {team.owner
                                                    ? team.owner.name || team.owner.email
                                                    : "Open Slot"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isCommissioner && team.ownerId && (
                                            <Link href={`/leagues/${league.id}/keepers?teamId=${team.id}`}>
                                                <Button variant="ghost" size="sm" className="text-xs h-7">
                                                    <Trophy className="mr-1 h-3 w-3" />
                                                    Keepers
                                                </Button>
                                            </Link>
                                        )}
                                        {team.ownerId === league.commissionerId && (
                                            <Badge variant="outline" className="text-xs">
                                                Commissioner
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Draft Settings */}
                {league.draftSettings && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings className="h-5 w-5" />
                                Draft Settings
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3 text-sm">
                                {settingsRows.map(([label, value], index) => (
                                    <React.Fragment key={label}>
                                        {index > 0 && <Separator />}
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">{label}</span>
                                            <span className="font-medium">{value}</span>
                                        </div>
                                    </React.Fragment>
                                ))}
                                <Separator />
                                <h4 className="font-medium pt-2">Roster Slots</h4>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    {rosterSlots.map(([label, count]) => (
                                        <div key={label} className="flex justify-between bg-muted/50 px-2 py-1 rounded">
                                            <span>{label}</span>
                                            <span className="font-mono">{count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

        </div>
    );
}
