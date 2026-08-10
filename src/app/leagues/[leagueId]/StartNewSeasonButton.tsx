'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startNewSeasonAction } from '@/app/actions/season';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { CalendarPlus } from 'lucide-react';

export default function StartNewSeasonButton({
    leagueId,
    leagueName,
    currentSeason,
}: {
    leagueId: string;
    leagueName: string;
    currentSeason: number;
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [championManagerName, setChampionManagerName] = useState('');
    const [championTeamName, setChampionTeamName] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const nameMatches = confirmText === leagueName;
    const newSeason = currentSeason + 1;

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setConfirmText('');
            setChampionManagerName('');
            setChampionTeamName('');
            setErrorMessage(null);
        }
    };

    const handleStart = () => {
        setErrorMessage(null);
        startTransition(async () => {
            const result = await startNewSeasonAction({
                leagueId,
                expectedSeason: currentSeason,
                championManagerName: championManagerName || undefined,
                championTeamName: championTeamName || undefined,
            });
            if (result.success) {
                handleOpenChange(false);
                router.refresh();
            } else {
                setErrorMessage(result.error || 'Failed to start new season');
            }
        });
    };

    return (
        <>
            <Button onClick={() => handleOpenChange(true)}>
                <CalendarPlus className="mr-2 h-4 w-4" />
                Start {newSeason} Season
            </Button>

            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <div className="flex items-center gap-2 mb-2">
                            <CalendarPlus className="w-6 h-6" />
                            <DialogTitle>Start the {newSeason} Season</DialogTitle>
                        </div>
                        <DialogDescription asChild>
                            <div className="space-y-2">
                                <p>Rolling over from {currentSeason} will:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>Archive every team&apos;s final {currentSeason} roster</li>
                                    <li>Clear all keeper selections — teams re-pick for {newSeason}</li>
                                    <li>Cancel any pending trades</li>
                                    <li>Create the {newSeason} draft board (traded picks keep their owners)</li>
                                    <li>Reset the keeper deadline — set a new one in League Settings</li>
                                </ul>
                                <p>
                                    The {currentSeason} draft results are kept. This cannot be undone.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Label htmlFor="champion-manager">
                            {currentSeason} Champion <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                            id="champion-manager"
                            value={championManagerName}
                            onChange={(e) => setChampionManagerName(e.target.value)}
                            placeholder="Manager name"
                            autoComplete="off"
                        />
                        <Input
                            id="champion-team"
                            value={championTeamName}
                            onChange={(e) => setChampionTeamName(e.target.value)}
                            placeholder="Team name (optional)"
                            autoComplete="off"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirm-season-league-name">
                            Type <span className="font-semibold">{leagueName}</span> to confirm
                        </Label>
                        <Input
                            id="confirm-season-league-name"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder={leagueName}
                            autoComplete="off"
                        />
                    </div>

                    {errorMessage && (
                        <div className="p-3 rounded-md text-sm bg-red-50 text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    <div className="flex justify-end gap-3 mt-4">
                        <Button
                            variant="outline"
                            onClick={() => handleOpenChange(false)}
                            disabled={isPending}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleStart} disabled={!nameMatches || isPending}>
                            {isPending ? 'Starting…' : `Start ${newSeason} Season`}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
