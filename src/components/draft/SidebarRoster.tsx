// Sidebar Roster Component
// Displays an organized view of a selected team's roster in the sidebar

'use client';

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Edit2 } from 'lucide-react';
import type { TeamSummary, RosterPlayer, RosterSettings } from '@/types/socket';

interface SidebarRosterProps {
    teams: TeamSummary[];
    teamRosters: Record<string, RosterPlayer[]>;
    rosterSettings?: RosterSettings;
    myTeamId?: string;
    initialSelectedTeamId?: string;
    onUpdateTeamName?: (teamId: string, name: string) => void;
}

// ============================================================================
// POSITION STYLE HELPERS
// ============================================================================

const posStyles: Record<string, string> = {
    QB: 'bg-pink-500/20 text-pink-500 border-pink-500/50',
    RB: 'bg-blue-500/20 text-blue-500 border-blue-500/50',
    WR: 'bg-green-500/20 text-green-500 border-green-500/50',
    TE: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50',
    K: 'bg-gray-500/20 text-gray-500 border-gray-500/50',
    DEF: 'bg-purple-500/20 text-purple-500 border-purple-500/50',
    DST: 'bg-purple-500/20 text-purple-500 border-purple-500/50',
    FLEX: 'bg-slate-100 text-slate-600 border-slate-200',
    BENCH: 'bg-slate-50 text-slate-400 border-slate-200',
};

// ============================================================================
// SIDEBAR ROSTER COMPONENT
// ============================================================================

export function SidebarRoster({
    teams,
    teamRosters,
    rosterSettings,
    myTeamId,
    initialSelectedTeamId,
    onUpdateTeamName,
}: SidebarRosterProps) {
    const [selectedTeamId, setSelectedTeamId] = useState<string>(
        initialSelectedTeamId || myTeamId || teams[0]?.id || ''
    );
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');

    // Sync when initialSelectedTeamId changes (e.g. clicking a team on the board)
    React.useEffect(() => {
        if (initialSelectedTeamId) {
            setSelectedTeamId(initialSelectedTeamId);
        }
    }, [initialSelectedTeamId]);

    const selectedTeam = useMemo(() =>
        teams.find(t => t.id === selectedTeamId),
        [teams, selectedTeamId]
    );

    const currentRoster = useMemo(() =>
        teamRosters[selectedTeamId] || [],
        [teamRosters, selectedTeamId]
    );

    const settings = useMemo(() => rosterSettings || {
        qbCount: 1, rbCount: 2, wrCount: 3, teCount: 1, flexCount: 2, superflexCount: 0, kCount: 1, defCount: 1, benchCount: 9,
    }, [rosterSettings]);

    // Organize roster into slots
    const organizedRoster = useMemo(() => {
        const slots: { pos: string; player?: RosterPlayer }[] = [];
        const add = (n: number, pos: string) => { for (let i = 0; i < n; i++) slots.push({ pos }); };

        add(settings.qbCount, 'QB');
        add(settings.rbCount, 'RB');
        add(settings.wrCount, 'WR');
        add(settings.teCount, 'TE');
        add(settings.flexCount, 'FLEX');
        add(settings.superflexCount, 'S-FLEX');
        add(settings.kCount, 'K');
        add(settings.defCount, 'DST');
        add(settings.benchCount, 'BENCH');

        const remaining = [...currentRoster];

        // Priority Fill
        const fill = (pos: string, matchFn: (p: RosterPlayer) => boolean) => {
            slots.filter(s => s.pos === pos && !s.player).forEach(slot => {
                const idx = remaining.findIndex(matchFn);
                if (idx !== -1) {
                    slot.player = remaining[idx];
                    remaining.splice(idx, 1);
                }
            });
        };

        fill('QB', p => p.position === 'QB');
        fill('RB', p => p.position === 'RB');
        fill('WR', p => p.position === 'WR');
        fill('TE', p => p.position === 'TE');
        fill('K', p => p.position === 'K');
        fill('DST', p => p.position === 'DEF');
        fill('FLEX', p => ['RB', 'WR', 'TE'].includes(p.position));
        fill('S-FLEX', p => ['QB', 'RB', 'WR', 'TE'].includes(p.position));
        fill('BENCH', () => true);

        // Overflow
        remaining.forEach(p => slots.push({ pos: 'BENCH', player: p }));

        return slots;
    }, [currentRoster, settings]);

    const stats = useMemo(() => {
        const drafted = currentRoster.filter(p => !p.isKeeper).length;
        const keepers = currentRoster.filter(p => p.isKeeper).length;
        return { drafted, keepers };
    }, [currentRoster]);

    return (
        <div className="flex flex-col h-full bg-white text-slate-900 border-l border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 space-y-4 bg-slate-900 border-b border-slate-800">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold tracking-wider text-slate-400 uppercase">Team Roster</h2>
                    {selectedTeamId === myTeamId && !isEditing && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-slate-500 hover:text-blue-400 hover:bg-white/5"
                            onClick={() => setIsEditing(true)}
                        >
                            <Edit2 className="w-4 h-4" />
                        </Button>
                    )}
                </div>

                {isEditing ? (
                    <div className="flex gap-2 animate-in fade-in duration-200">
                        <Input 
                            value={editName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') {
                                    if (editName.trim()) onUpdateTeamName?.(selectedTeamId, editName.trim());
                                    setIsEditing(false);
                                }
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                            autoFocus
                            className="h-9 text-sm bg-slate-800 border-slate-700 text-white focus:ring-blue-500"
                            placeholder="Enter team name"
                        />
                        <Button 
                            size="sm" 
                            className="h-9 px-3 bg-blue-600 hover:bg-blue-700 text-xs font-bold"
                            onClick={() => {
                                if (editName.trim()) onUpdateTeamName?.(selectedTeamId, editName.trim());
                                setIsEditing(false);
                            }}
                        >
                            Save
                        </Button>
                    </div>
                ) : (
                    <Select value={selectedTeamId} onValueChange={(val) => {
                        setSelectedTeamId(val);
                        setIsEditing(false);
                    }}>
                        <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-sm h-10 ring-offset-transparent focus:ring-blue-500/50">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                <SelectValue placeholder="Select Team" />
                            </div>
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-800 text-white shadow-xl">
                            {teams.map(t => (
                                <SelectItem key={t.id} value={t.id} className="hover:bg-slate-800 focus:bg-slate-800 cursor-pointer">
                                    <span className={cn(t.id === myTeamId && "font-bold text-blue-400")}>
                                        {t.name} {t.id === myTeamId && "(You)"}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Team Meta */}
                <div className="flex items-center justify-between text-xs pt-1">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-300">@{selectedTeam?.ownerName}</span>
                        </div>
                        <div className="text-slate-500 font-mono tracking-tighter uppercase px-1.5 py-0.5 bg-slate-800/50 rounded-md w-fit">
                            Pick #{selectedTeam?.draftPosition || 0}
                        </div>
                    </div>
                    <div className="text-right space-y-1">
                        <div className="text-slate-300 font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                            {stats.drafted} <span className="text-slate-500 font-normal">drafted</span>
                        </div>
                        <div className="text-slate-300 font-bold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            {stats.keepers} <span className="text-slate-500 font-normal">keepers</span>
                        </div>
                    </div>
                </div>
            </div>

            <Separator className="bg-slate-200" />

            {/* Roster List */}
            <ScrollArea className="flex-1">
                <div className="p-0 border-t border-slate-100">
                    {organizedRoster.map((slot, idx) => (
                        <div key={idx} className={cn(
                            "flex items-center px-4 py-2 gap-3 group transition-colors border-b border-slate-50",
                            slot.player ? "bg-white" : "bg-slate-50/50 opacity-60"
                        )}>
                            {/* Pos Badge */}
                            <div className="w-10">
                                <span className={cn(
                                    "block w-full text-center text-[9px] font-black py-0.5 rounded-sm border uppercase",
                                    posStyles[slot.pos] || posStyles.BENCH
                                )}>
                                    {slot.pos}
                                </span>
                            </div>

                            {/* Status Code (R1, K, etc.) */}
                            <div className="w-6 text-[10px] font-mono text-slate-500 font-bold">
                                {slot.player?.isKeeper ? 'K' : slot.player?.round ? `R${slot.player.round}` : '-'}
                            </div>

                            {/* Player Info */}
                            <div className="flex-1 min-w-0">
                                {slot.player ? (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold truncate text-slate-900">
                                            {slot.player.fullName}
                                        </span>
                                        {slot.player.isKeeper && <Lock className="w-2.5 h-2.5 text-slate-400" />}
                                    </div>
                                ) : (
                                    <span className="text-xs text-slate-600 font-medium italic">Empty</span>
                                )}
                            </div>

                            {/* Position Dot */}
                            {slot.player && (
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    slot.pos === 'QB' ? 'bg-pink-500' :
                                        slot.pos === 'RB' ? 'bg-blue-500' :
                                            slot.pos === 'WR' ? 'bg-green-500' :
                                                slot.pos === 'TE' ? 'bg-yellow-500' : 'bg-slate-600'
                                )} />
                            )}
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

export default SidebarRoster;
