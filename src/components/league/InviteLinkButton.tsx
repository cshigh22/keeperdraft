'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Link, Copy, Check, ExternalLink, UserPlus } from 'lucide-react';
import { generateInvite } from '@/server/actions/league';

interface InviteLinkProps {
    leagueId: string;
}

/**
 * The generate/copy invite-link flow. Renders dialog header + content,
 * so it must be placed inside a <DialogContent>.
 */
export function InviteLinkPanel({ leagueId }: InviteLinkProps) {
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
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Link className="w-5 h-5" />
                    Invite Members
                </DialogTitle>
                <DialogDescription>
                    Generate a link to invite someone to your league. Each link works once,
                    so generate a new one for each person.
                </DialogDescription>
            </DialogHeader>
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
                        Single use — expires in 7 days
                    </p>
                    <Button
                        variant="outline"
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? 'Generating...' : 'Generate Another Link'}
                    </Button>
                </div>
            )}
        </>
    );
}

/** Compact trigger button that opens the invite flow in a dialog. */
export function InviteLinkButton({ leagueId }: InviteLinkProps) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <UserPlus className="w-4 h-4" />
                    Invite Members
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <InviteLinkPanel leagueId={leagueId} />
            </DialogContent>
        </Dialog>
    );
}
