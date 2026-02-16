'use client';

import React, { useState, useTransition } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GripVertical, Shuffle } from 'lucide-react';
import { setDraftOrderAction, randomizeDraftOrderAction } from '@/app/actions/commissioner';
import { useRouter } from 'next/navigation';

interface Team {
    id: string;
    name: string;
    draftPosition: number;
    owner?: {
        name: string | null;
    } | null;
}

interface DraftOrderSettingsProps {
    leagueId: string;
    teams: Team[];
    isLocked: boolean;
}

export function DraftOrderSettings({ leagueId, teams: initialTeams, isLocked }: DraftOrderSettingsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [teams, setTeams] = useState([...initialTeams].sort((a, b) => (a.draftPosition || 0) - (b.draftPosition || 0)));
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const onDragEnd = (result: any) => {
        if (!result.destination || isLocked) return;

        const newTeams = Array.from(teams);
        const [reorderedItem] = newTeams.splice(result.source.index, 1);
        if (reorderedItem) {
            newTeams.splice(result.destination.index, 0, reorderedItem);
            setTeams(newTeams);
        }
    };

    const handleSaveOrder = async () => {
        setMessage(null);
        startTransition(async () => {
            const teamIds = teams.map(t => t.id);
            const result = await setDraftOrderAction(leagueId, teamIds);

            if (result.success) {
                setMessage({ type: 'success', text: 'Draft order saved successfully' });
                router.refresh();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to save draft order' });
            }
        });
    };

    const handleRandomize = async () => {
        if (isLocked) return;
        if (!confirm('Are you sure you want to randomize the draft order? This will overwrite your current order.')) return;

        setMessage(null);
        startTransition(async () => {
            const result = await randomizeDraftOrderAction(leagueId);

            if (result.success) {
                const newTeams = result.data?.teams.sort((a: any, b: any) => a.draftPosition - b.draftPosition);
                if (newTeams) setTeams(newTeams);
                setMessage({ type: 'success', text: 'Draft order randomized' });
                router.refresh();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to randomize draft order' });
            }
        });
    };

    return (
        <Card className="mt-8">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Draft Order</CardTitle>
                    <CardDescription>
                        Drag and drop teams to set the draft order. This determines the pick sequence for all rounds.
                    </CardDescription>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRandomize}
                    disabled={isPending || isLocked}
                    className="flex items-center gap-2"
                >
                    <Shuffle className="h-4 w-4" />
                    Randomize
                </Button>
            </CardHeader>
            <CardContent>
                {message && (
                    <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="teams">
                        {(provided) => (
                            <div
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                                className="space-y-2"
                            >
                                {teams.map((team, index) => (
                                    <Draggable
                                        key={team.id}
                                        draggableId={team.id}
                                        index={index}
                                        isDragDisabled={isLocked}
                                    >
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                className={`flex items-center gap-4 p-3 rounded-lg border bg-card transition-shadow ${snapshot.isDragging ? 'shadow-lg border-primary' : ''
                                                    } ${isLocked ? 'opacity-75' : ''}`}
                                            >
                                                <div
                                                    {...provided.dragHandleProps}
                                                    className={`text-muted-foreground ${isLocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                                                >
                                                    <GripVertical className="h-5 w-5" />
                                                </div>
                                                <div className="flex-none w-8 font-bold text-muted-foreground">
                                                    {index + 1}
                                                </div>
                                                <div className="flex-grow">
                                                    <div className="font-medium">{team.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {team.owner?.name || 'Open Slot'}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>

                <div className="flex justify-end mt-6">
                    <Button
                        onClick={handleSaveOrder}
                        disabled={isPending || isLocked}
                    >
                        {isPending ? 'Saving...' : 'Save Draft Order'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
