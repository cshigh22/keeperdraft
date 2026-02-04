// Login/Team Selection Page
// Simple mock login to select which team to simulate

'use client';

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Users, Shield, Trophy, ArrowRight, Loader2 } from 'lucide-react';
import { getTeamsByLeague } from '@/lib/actions';

// ============================================================================
// LOGIN PAGE
// ============================================================================

export default function LoginPage() {
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingTeams, setIsFetchingTeams] = useState(true);

  // Fetch real teams from database
  useEffect(() => {
    async function fetchTeams() {
      try {
        const data = await getTeamsByLeague();
        setTeams(data);
      } catch (error) {
        console.error('Failed to fetch teams:', error);
      } finally {
        setIsFetchingTeams(false);
      }
    }
    fetchTeams();
  }, []);

  // Check if already logged in
  useEffect(() => {
    const stored = localStorage.getItem('draftSession');
    if (stored) {
      window.location.href = '/draft';
    }
  }, []);

  const handleLogin = () => {
    if (!selectedTeam) return;

    setIsLoading(true);

    // Simulate login delay
    setTimeout(() => {
      const session = {
        userId: selectedTeam.ownerId,
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        isCommissioner: selectedTeam.isCommissioner,
      };

      localStorage.setItem('draftSession', JSON.stringify(session));
      window.location.href = '/draft';
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Trophy className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl">KeeperDraft</CardTitle>
          <CardDescription className="text-base">
            Fantasy Football Keeper League Draft
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Instructions */}
          <div className="bg-muted rounded-lg p-4">
            <h3 className="font-semibold mb-2">Demo Mode</h3>
            <p className="text-sm text-muted-foreground">
              Select a team below to simulate the draft experience. The
              commissioner team has access to additional controls.
            </p>
          </div>

          <Separator />

          {/* Team Selection */}
          <div>
            <Label className="text-base mb-4 block">Select Your Team</Label>
            <ScrollArea className="h-[300px] border rounded-lg">
              <div className="p-2 space-y-2">
                {isFetchingTeams ? (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
                    <p>Loading teams...</p>
                  </div>
                ) : teams.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-center p-4">
                    <p>No teams found. Make sure the database is seeded.</p>
                  </div>
                ) : (
                  teams.map((team) => (
                    <div
                      key={team.id}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all',
                        'hover:bg-accent/50',
                        selectedTeam?.id === team.id
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent'
                      )}
                      onClick={() => setSelectedTeam(team)}
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center',
                          team.isCommissioner
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        {team.isCommissioner ? (
                          <Shield className="w-5 h-5" />
                        ) : (
                          <Users className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">{team.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {team.ownerName}
                        </p>
                      </div>
                      {team.isCommissioner && (
                        <Badge variant="secondary" className="shrink-0">
                          Commissioner
                        </Badge>
                      )}
                      {selectedTeam?.id === team.id && (
                        <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                          <ArrowRight className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Selected Team Summary */}
          {selectedTeam && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center',
                    selectedTeam.isCommissioner
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-primary/10 text-primary'
                  )}
                >
                  {selectedTeam.isCommissioner ? (
                    <Shield className="w-6 h-6" />
                  ) : (
                    <Users className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <p className="font-semibold">{selectedTeam.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Joining as {selectedTeam.ownerName}
                    {selectedTeam.isCommissioner && ' (Commissioner)'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Login Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleLogin}
            disabled={!selectedTeam || isLoading}
          >
            {isLoading ? (
              'Joining Draft Room...'
            ) : (
              <>
                Enter Draft Room
                <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </Button>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground">
            This is a demo application. In production, use proper authentication.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
