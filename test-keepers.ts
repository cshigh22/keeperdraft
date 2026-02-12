
import { PrismaClient } from '@prisma/client';
import { KeeperService } from './src/services/keeper.service';

const prisma = new PrismaClient();
const keeperService = new KeeperService();

// Mock Data is replaced by dynamic fetch
let LEAGUE_ID = '';
let TEAM_ID = '';

async function testKeepers() {
    console.log('--- Testing Keeper Service ---');

    // 0. Setup: Find a team and league
    const team = await prisma.team.findFirst();
    if (!team) {
        console.error('No teams found in DB. Please create a league/team first.');
        return;
    }
    TEAM_ID = team.id;
    LEAGUE_ID = team.leagueId;
    console.log(`Using Team: ${TEAM_ID} (League: ${LEAGUE_ID})`);

    // 1. Get Potential Keepers
    console.log(`\n1. Fetching potential keepers for team ${TEAM_ID}...`);
    const roster = await keeperService.getPotentialKeepers(TEAM_ID, LEAGUE_ID);
    console.log(`Found ${roster.length} players on roster.`);

    if (roster.length === 0) {
        console.log('No players found on roster. Creating a test player...');
        // Create a player and add to roster
        const player = await prisma.player.create({
            data: {
                sleeperId: `test-player-${Date.now()}`,
                firstName: 'Test',
                lastName: 'Keeper',
                fullName: 'Test Keeper',
                position: 'QB',
                nflTeam: 'KC',
            }
        });

        await prisma.playerRoster.create({
            data: {
                teamId: TEAM_ID,
                playerId: player.id,
                leagueId: LEAGUE_ID,
                acquiredVia: 'DRAFTED',
            }
        });

        // Re-fetch
        const newRoster = await keeperService.getPotentialKeepers(TEAM_ID, LEAGUE_ID);
        roster.push(...newRoster);
    }

    const keeperPlayer = roster[0]!;
    console.log(`Selected candidate: ${keeperPlayer.player.firstName} ${keeperPlayer.player.lastName} (${keeperPlayer.playerId})`);

    // 2. Set Keeper Settings (ensure deadline is future)
    console.log('\n2. Updating league settings for test...');
    await prisma.draftSettings.upsert({
        where: { leagueId: LEAGUE_ID },
        create: {
            leagueId: LEAGUE_ID,
            maxKeepers: 3,
            keeperDeadline: new Date(Date.now() + 86400000), // Tomorrow
        },
        update: {
            maxKeepers: 3,
            keeperDeadline: new Date(Date.now() + 86400000),
        },
    });

    // 3. Save Keepers
    console.log('\n3. Saving keeper selection...');
    const selections = [
        { playerId: keeperPlayer.playerId, keeperRound: 10 }
    ];

    try {
        await keeperService.saveKeepers(TEAM_ID, LEAGUE_ID, selections);
        console.log('Keepers saved successfully.');
    } catch (error) {
        console.error('Error saving keepers:', error);
    }

    // 4. Verify Persistence
    console.log('\n4. Verifying persistence...');
    const updatedRoster = await prisma.playerRoster.findUnique({
        where: {
            teamId_playerId: {
                teamId: TEAM_ID,
                playerId: keeperPlayer.playerId,
            },
        },
    });

    if (updatedRoster?.isKeeper && updatedRoster?.keeperRound === 10) {
        console.log('SUCCESS: Player is marked as keeper with correct round.');
    } else {
        console.error('FAILURE: Player keeper status incorrect:', updatedRoster);
    }

    // 5. Cleanup (optional)
    // await keeperService.saveKeepers(TEAM_ID, LEAGUE_ID, []);
    // console.log('\n5. Cleanup complete.');
}

testKeepers()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
