'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, Copy, Check, ExternalLink } from 'lucide-react';
import { generateInvite } from '@/server/actions/league';

interface InviteLinkButtonProps {
    leagueId: string;
}

export function InviteLinkButton({ leagueId }: InviteLinkButtonProps) {
    const [inviteToken, setInviteToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        try {
            const token = await generateInvite(leagueId);
            setInviteToken(token);
        } catch (error) {
            console.error('Failed to generate invite:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const inviteUrl = inviteToken
        ? `${window.location.origin}/join/${inviteToken}`
        : '';

    const handleCopy = () => {
        if (!inviteUrl) return;
        navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className="w-full">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Link className="w-5 h-5" />
                    Invite Members
                </CardTitle>
                <CardDescription>
                    Generate a link to invite others to join your league.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {!inviteToken ? (
                    <Button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? 'Generating...' : 'Generate Invite Link'}
                    </Button>
                ) : (
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <Input
                                readOnly
                                value={inviteUrl}
                                className="bg-muted font-mono text-xs"
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleCopy}
                                className="shrink-0"
                            >
                                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />
                            Link expires in 7 days
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
