'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Edit2, Check, X } from 'lucide-react';
import { updateTeamName } from '@/app/actions/team';
import { useRouter } from 'next/navigation';

interface EditableTeamNameProps {
    teamId: string;
    leagueId: string;
    initialName: string;
    isEditable: boolean;
}

export function EditableTeamName({ teamId, leagueId, initialName, isEditable }: EditableTeamNameProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(initialName);
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    if (!isEditable) {
        return <p className="font-medium text-sm">{name}</p>;
    }

    const handleSave = async () => {
        if (!name.trim() || name === initialName) {
            setIsEditing(false);
            return;
        }

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append('teamId', teamId);
            formData.append('leagueId', leagueId);
            formData.append('name', name.trim());
            
            await updateTeamName(formData);
            
            setIsEditing(false);
            // Refresh to update current page state
            router.refresh();
        } catch (error) {
            console.error('Failed to update team name:', error);
            setName(initialName);
        } finally {
            setIsLoading(false);
        }
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-8 text-sm focus-visible:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') {
                            setName(initialName);
                            setIsEditing(false);
                        }
                    }}
                    disabled={isLoading}
                />
                <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={handleSave}
                    disabled={isLoading}
                >
                    <Check className="h-4 w-4" />
                </Button>
                <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => {
                        setName(initialName);
                        setIsEditing(false);
                    }}
                    disabled={isLoading}
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 group">
            <p className="font-medium text-sm">{name}</p>
            <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400"
                onClick={() => setIsEditing(true)}
            >
                <Edit2 className="h-3 w-3" />
            </Button>
        </div>
    );
}
