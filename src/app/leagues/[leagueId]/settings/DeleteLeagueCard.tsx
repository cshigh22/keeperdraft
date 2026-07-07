'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteLeague } from '@/server/actions/league';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

export default function DeleteLeagueCard({
    leagueId,
    leagueName,
}: {
    leagueId: string;
    leagueName: string;
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const nameMatches = confirmText === leagueName;

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setConfirmText('');
            setErrorMessage(null);
        }
    };

    const handleDelete = () => {
        setErrorMessage(null);
        startTransition(async () => {
            const result = await deleteLeague(leagueId);
            if (result.success) {
                router.push('/leagues');
                router.refresh();
            } else {
                setErrorMessage(result.message || 'Failed to delete league');
            }
        });
    };

    return (
        <Card className="border-destructive/50">
            <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                    Permanently delete this league, including all teams, rosters, draft history,
                    trades, and champions.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button variant="destructive" onClick={() => handleOpenChange(true)}>
                    Delete League
                </Button>

                <Dialog open={open} onOpenChange={handleOpenChange}>
                    <DialogContent>
                        <DialogHeader>
                            <div className="flex items-center gap-2 text-destructive mb-2">
                                <AlertTriangle className="w-6 h-6" />
                                <DialogTitle>Delete League</DialogTitle>
                            </div>
                            <DialogDescription>
                                This permanently deletes <span className="font-bold">{leagueName}</span> and
                                all of its data: teams, rosters, draft history, trades, and champions.
                                This action <span className="font-bold text-destructive">cannot be undone</span>.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="confirm-league-name">
                                Type <span className="font-semibold">{leagueName}</span> to confirm
                            </Label>
                            <Input
                                id="confirm-league-name"
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
                            <Button
                                variant="destructive"
                                onClick={handleDelete}
                                disabled={!nameMatches || isPending}
                            >
                                {isPending ? 'Deleting…' : 'Delete League'}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
