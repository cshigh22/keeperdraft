import { joinLeague } from '@/server/actions/league';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default async function JoinPage({ params }: { params: { token: string } }) {
    try {
        // This is a server component, so we can call the action directly or use a handler
        // But joinLeague redirects, so we just call it.
        await joinLeague(params.token);

        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4 text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <h2 className="text-xl font-semibold">Joining league...</h2>
                    <p className="text-muted-foreground">Setting up your team.</p>
                </div>
            </div>
        );
    } catch (error: any) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="max-w-md w-full border-destructive/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                            <AlertCircle className="w-6 h-6" />
                            Invite Error
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground">
                            {error.message || "Something went wrong with this invite link. It may be expired or invalid."}
                        </p>
                        <Button
                            className="w-full"
                            onClick={() => window.location.href = '/'}
                        >
                            Back to Home
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }
}
