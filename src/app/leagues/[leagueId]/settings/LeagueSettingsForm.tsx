'use client';

import React, { useTransition, useState } from 'react';
import { updateLeague } from '@/server/actions/league';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useRouter } from 'next/navigation';

const ROSTER_POSITIONS = [
    { id: 'qbCount', label: 'QB' },
    { id: 'rbCount', label: 'RB' },
    { id: 'wrCount', label: 'WR' },
    { id: 'teCount', label: 'TE' },
    { id: 'flexCount', label: 'FLEX (RB/WR/TE)' },
    { id: 'superflexCount', label: 'SUPERFLEX (QB/RB/WR/TE)' },
    { id: 'kCount', label: 'K' },
    { id: 'defCount', label: 'DEF' },
    { id: 'benchCount', label: 'BENCH' },
];

export default function LeagueSettingsForm({ league }: { league: any }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const settings = league.draftSettings || {};
    const draftStatus = league.draftState?.status || 'NOT_STARTED';
    const isLocked = draftStatus !== 'NOT_STARTED' && draftStatus !== 'PAUSED';

    const handleSubmit = async (formData: FormData) => {
        setStatusMessage(null);
        startTransition(async () => {
            const result = await updateLeague(league.id, null, formData);
            if (result.success) {
                setStatusMessage({ type: 'success', text: 'Settings updated successfully' });
                router.refresh();
                // Optionally redirect after a short delay
                setTimeout(() => router.push(`/leagues/${league.id}`), 1500);
            } else {
                setStatusMessage({ type: 'error', text: result.message || 'Failed to update settings' });
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Edit League Settings</CardTitle>
                <CardDescription>
                    Update your league configuration. Some settings are locked once the draft begins.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form action={handleSubmit} className="space-y-8">
                    {statusMessage && (
                        <div className={`p-3 rounded-md text-sm ${statusMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                            }`}>
                            {statusMessage.text}
                        </div>
                    )}

                    {/* General Settings */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">General Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">League Name</Label>
                                <Input id="name" name="name" defaultValue={league.name} required />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="draftType">Draft Type</Label>
                                <Select name="draftType" defaultValue={settings.draftType} disabled={isLocked}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select draft type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SNAKE">Snake</SelectItem>
                                        <SelectItem value="LINEAR">Linear</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="maxKeepers">Max Keepers per Team</Label>
                                <Input
                                    id="maxKeepers"
                                    name="maxKeepers"
                                    type="number"
                                    min="0"
                                    defaultValue={settings.maxKeepers}
                                    disabled={isLocked}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="timerDurationSeconds">Pick Timer (seconds)</Label>
                                <Input
                                    id="timerDurationSeconds"
                                    name="timerDurationSeconds"
                                    type="number"
                                    min="10"
                                    step="5"
                                    defaultValue={settings.timerDurationSeconds}
                                />
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Roster Settings */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Roster Settings</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Define the starting lineup and bench size.
                            {isLocked && <span className="text-red-500 block mt-1">Locked because draft has started.</span>}
                        </p>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {ROSTER_POSITIONS.map((pos) => (
                                <div key={pos.id} className="space-y-2">
                                    <Label htmlFor={pos.id}>{pos.label}</Label>
                                    <Input
                                        id={pos.id}
                                        name={pos.id}
                                        type="number"
                                        min="0"
                                        defaultValue={settings[pos.id] || 0}
                                        className="w-full"
                                        disabled={isLocked}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button type="button" variant="outline" onClick={() => router.back()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
