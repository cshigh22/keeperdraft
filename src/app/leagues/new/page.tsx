'use client';

import React from 'react';
import { useFormState } from 'react-dom';
import { createLeague } from '@/server/actions/league';
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

const ROSTER_POSITIONS = [
    { id: 'qbCount', label: 'QB', default: 1 },
    { id: 'rbCount', label: 'RB', default: 2 },
    { id: 'wrCount', label: 'WR', default: 3 },
    { id: 'teCount', label: 'TE', default: 1 },
    { id: 'flexCount', label: 'FLEX (RB/WR/TE)', default: 2 },
    { id: 'superflexCount', label: 'SUPERFLEX (QB/RB/WR/TE)', default: 0 },
    { id: 'kCount', label: 'K', default: 1 },
    { id: 'defCount', label: 'DEF', default: 1 },
    { id: 'benchCount', label: 'BENCH', default: 9 },
];

export default function CreateLeaguePage() {
    const [state, formAction] = useFormState(createLeague, {});

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Create New League</CardTitle>
                    <CardDescription>
                        Set up your league settings, draft type, and roster configuration.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} className="space-y-8">
                        {/* General Settings */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">General Settings</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">League Name</Label>
                                    <Input id="name" name="name" placeholder="My Awesome League" required />
                                    {state.errors?.name && <p className="text-sm text-red-500">{state.errors.name[0]}</p>}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="maxTeams">Number of Teams</Label>
                                    <Input
                                        id="maxTeams"
                                        name="maxTeams"
                                        type="number"
                                        min="4"
                                        max="32"
                                        defaultValue="12"
                                        required
                                    />
                                    {state.errors?.maxTeams && <p className="text-sm text-red-500">{state.errors.maxTeams[0]}</p>}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="draftType">Draft Type</Label>
                                    <Select name="draftType" defaultValue="SNAKE">
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select draft type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="SNAKE">Snake</SelectItem>
                                            <SelectItem value="LINEAR">Linear</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {state.errors?.draftType && <p className="text-sm text-red-500">{state.errors.draftType[0]}</p>}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="maxKeepers">Max Keepers per Team</Label>
                                    <Input
                                        id="maxKeepers"
                                        name="maxKeepers"
                                        type="number"
                                        min="0"
                                        defaultValue="3"
                                    />
                                    {state.errors?.maxKeepers && <p className="text-sm text-red-500">{state.errors.maxKeepers[0]}</p>}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        {/* Roster Settings */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Roster Settings</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Define the starting lineup and bench size.
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
                                            defaultValue={pos.default}
                                            className="w-full"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {state.message && (
                            <div className="p-4 bg-red-50 text-red-600 rounded-md text-sm">
                                {state.message}
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <Button type="submit" size="lg">
                                Create League
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
