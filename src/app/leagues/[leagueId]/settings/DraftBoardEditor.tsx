'use client';

import React, { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { manuallyAssignPickOwnerAction } from '@/app/actions/commissioner';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';

interface Pick {
    id: string;
    round: number;
    pickInRound: number;
    overallPickNumber: number | null;
    currentOwnerId: string;
    originalOwnerId: string;
    currentOwner: {
        id: string;
        name: string;
    };
    isComplete: boolean;
}

interface Team {
    id: string;
    name: string;
}

interface DraftBoardEditorProps {
    leagueId: string;
    picks: Pick[];
    teams: Team[];
    isLocked: boolean;
}

export function DraftBoardEditor({ leagueId, picks, teams, isLocked }: DraftBoardEditorProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [selectedPick, setSelectedPick] = useState<Pick | null>(null);
    const [newOwnerId, setNewOwnerId] = useState<string>('');
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const rounds = Array.from(new Set(picks.map(p => p.round))).sort((a, b) => a - b);

    const handleAssignOwner = async () => {
        if (!selectedPick || !newOwnerId) return;

        setMessage(null);
        startTransition(async () => {
            const result = await manuallyAssignPickOwnerAction(leagueId, selectedPick.id, newOwnerId);

            if (result.success) {
                setMessage({ type: 'success', text: `Pick ${selectedPick.round}.${selectedPick.pickInRound} reassigned successfully` });
                setSelectedPick(null);
                setNewOwnerId('');
                router.refresh();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to reassign pick' });
            }
        });
    };

    return (
        <Card className="mt-8">
            <CardHeader>
                <CardTitle>Draft Board Editor (God Mode)</CardTitle>
                <CardDescription>
                    Manually override the ownership of any specific pick. Traded picks are highlighted.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {message && (
                    <div className={`mb-6 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="space-y-8">
                    {rounds.map(round => (
                        <div key={round} className="space-y-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                Round {round}
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {picks.filter(p => p.round === round).map(pick => {
                                    const isTraded = pick.currentOwnerId !== pick.originalOwnerId;
                                    return (
                                        <Dialog
                                            key={pick.id}
                                            open={selectedPick?.id === pick.id}
                                            onOpenChange={(open) => {
                                                if (!open) setSelectedPick(null);
                                                else if (!isLocked) {
                                                    setSelectedPick(pick);
                                                    setNewOwnerId(pick.currentOwnerId);
                                                }
                                            }}
                                        >
                                            <DialogTrigger asChild>
                                                <button
                                                    disabled={isLocked || pick.isComplete}
                                                    className={`
                                                        relative flex flex-col p-3 rounded-lg border text-left transition-all
                                                        ${pick.isComplete ? 'bg-muted opacity-50 cursor-not-allowed' : 'hover:border-primary hover:shadow-sm'}
                                                        ${isTraded ? 'border-amber-200 bg-amber-50/50' : 'bg-card'}
                                                        ${isLocked ? 'cursor-default' : 'cursor-pointer'}
                                                    `}
                                                >
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className="text-xs font-bold text-muted-foreground">
                                                            {pick.round}.{pick.pickInRound}
                                                        </span>
                                                        {isTraded && (
                                                            <Badge variant="outline" className="text-[10px] px-1 h-4 bg-amber-100 text-amber-800 border-amber-300">
                                                                TRADED
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="font-medium text-sm truncate w-full">
                                                        {pick.currentOwner.name}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground mt-1">
                                                        Pick #{pick.overallPickNumber}
                                                    </div>
                                                </button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Reassign Pick {pick.round}.{pick.pickInRound}</DialogTitle>
                                                    <DialogDescription>
                                                        Change the current owner of this specific draft pick.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <div className="space-y-4 py-4">
                                                    <div className="space-y-2">
                                                        <Label>Current Owner</Label>
                                                        <div className="p-2 bg-muted rounded text-sm">
                                                            {pick.currentOwner.name}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label htmlFor="new-owner">New Owner</Label>
                                                        <Select value={newOwnerId} onValueChange={setNewOwnerId}>
                                                            <SelectTrigger id="new-owner">
                                                                <SelectValue placeholder="Select a team" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {teams.map(team => (
                                                                    <SelectItem key={team.id} value={team.id}>
                                                                        {team.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => setSelectedPick(null)}>
                                                        Cancel
                                                    </Button>
                                                    <Button onClick={handleAssignOwner} disabled={isPending || newOwnerId === pick.currentOwnerId}>
                                                        {isPending ? 'Assigning...' : 'Assign Owner'}
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
