// Database Seed Script
// Run with: npm run db:seed

import { PrismaClient } from '@prisma/client';
import { seedPlayersFromSleeper } from '../src/lib/sleeper-api';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Seed players from Sleeper API
  console.log('📥 Fetching and seeding NFL players from Sleeper API...');
  console.log('   This may take a few minutes...\n');

  const playerResult = await seedPlayersFromSleeper();

  console.log('\n📊 Player Seed Results:');
  console.log(`   Total players from API: ${playerResult.totalPlayers}`);
  console.log(`   Inserted: ${playerResult.insertedPlayers}`);
  console.log(`   Updated: ${playerResult.updatedPlayers}`);
  console.log(`   Skipped: ${playerResult.skippedPlayers}`);
  
  if (playerResult.errors.length > 0) {
    console.log(`   Errors: ${playerResult.errors.length}`);
    playerResult.errors.slice(0, 5).forEach((err) => console.log(`     - ${err}`));
    if (playerResult.errors.length > 5) {
      console.log(`     ... and ${playerResult.errors.length - 5} more`);
    }
  }

  // Create demo data for development
  if (process.env.NODE_ENV === 'development') {
    console.log('\n🔧 Creating demo data for development...');

    // Create a demo commissioner user
    const commissioner = await prisma.user.upsert({
      where: { email: 'commissioner@demo.com' },
      update: {},
      create: {
        email: 'commissioner@demo.com',
        passwordHash: '$2a$10$demo-hash', // Not a real hash - for demo only
        name: 'Demo Commissioner',
        isAdmin: true,
      },
    });
    console.log(`   Created commissioner: ${commissioner.email}`);

    // Create demo users (only need 1 for team-2)
    const player1 = await prisma.user.upsert({
      where: { email: 'player1@demo.com' },
      update: {},
      create: {
        email: 'player1@demo.com',
        passwordHash: '$2a$10$demo-hash',
        name: 'Demo Player 1',
      },
    });
    console.log('   Created 1 demo user');

    // Create a demo league
    const league = await prisma.league.upsert({
      where: { id: 'demo-league' },
      update: {},
      create: {
        id: 'demo-league',
        name: 'Demo Keeper League',
        season: new Date().getFullYear(),
        maxTeams: 2,
        commissionerId: commissioner.id,
      },
    });
    console.log(`   Created league: ${league.name}`);

    // Add commissioner as league member
    await prisma.leagueMember.upsert({
      where: {
        userId_leagueId: {
          userId: commissioner.id,
          leagueId: league.id,
        },
      },
      update: {},
      create: {
        userId: commissioner.id,
        leagueId: league.id,
        role: 'COMMISSIONER',
      },
    });

    // Create teams with fixed IDs to match login page
    const team1 = await prisma.team.upsert({
      where: { id: 'team-1' },
      update: {
        name: 'Gridiron Giants',
        ownerId: commissioner.id,
        leagueId: league.id,
        draftPosition: 1,
      },
      create: {
        id: 'team-1',
        name: 'Gridiron Giants',
        ownerId: commissioner.id,
        leagueId: league.id,
        draftPosition: 1,
      },
    });

    const team2 = await prisma.team.upsert({
      where: { id: 'team-2' },
      update: {
        name: 'Touchdown Titans',
        ownerId: player1.id,
        leagueId: league.id,
        draftPosition: 2,
      },
      create: {
        id: 'team-2',
        name: 'Touchdown Titans',
        ownerId: player1.id,
        leagueId: league.id,
        draftPosition: 2,
      },
    });

    // Add player1 as league member
    await prisma.leagueMember.upsert({
      where: {
        userId_leagueId: {
          userId: player1.id,
          leagueId: league.id,
        },
      },
      update: {},
      create: {
        userId: player1.id,
        leagueId: league.id,
        role: 'MEMBER',
      },
    });

    const teams = [team1, team2];
    console.log(`   Created ${teams.length} teams`);

    // Create draft settings
    await prisma.draftSettings.upsert({
      where: { leagueId: league.id },
      update: {},
      create: {
        leagueId: league.id,
        draftType: 'LINEAR',
        totalRounds: 14,
        timerDurationSeconds: 90,
        reserveTimeSeconds: 120,
        pauseOnTrade: true,
        maxKeepers: 7,
      },
    });
    console.log('   Created draft settings');

    // Create draft state
    await prisma.draftState.upsert({
      where: { leagueId: league.id },
      update: {},
      create: {
        leagueId: league.id,
        status: 'NOT_STARTED',
        currentRound: 1,
        currentPick: 1,
      },
    });
    console.log('   Created draft state');

    // Generate draft picks for 2 teams, 14 rounds
    const picks: {
      leagueId: string;
      season: number;
      round: number;
      pickInRound: number;
      overallPickNumber: number;
      originalOwnerId: string;
      currentOwnerId: string;
    }[] = [];
    let overallPick = 1;
    for (let round = 1; round <= 14; round++) {
      // LINEAR draft - same order every round
      teams.forEach((team, index) => {
        const pickInRound = index + 1;
        picks.push({
          leagueId: league.id,
          season: new Date().getFullYear(),
          round,
          pickInRound,
          overallPickNumber: overallPick,
          originalOwnerId: team.id,
          currentOwnerId: team.id,
        });
        overallPick++;
      });
    }

    await prisma.draftPick.createMany({
      data: picks,
      skipDuplicates: true,
    });
    console.log(`   Generated ${picks.length} draft picks`);

    console.log('\n✅ Demo data created successfully!');
    console.log('\n📝 Demo Credentials:');
    console.log('   Commissioner: commissioner@demo.com');
    console.log('   Players: player1@demo.com through player11@demo.com');
  }

  console.log('\n🎉 Database seed complete!\n');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
