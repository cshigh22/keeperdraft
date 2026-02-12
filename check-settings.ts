
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const LEAGUE_ID = 'demo-league';

async function checkSettings() {
    const settings = await prisma.draftSettings.findUnique({
        where: { leagueId: LEAGUE_ID },
    });
    console.log('Draft Settings:', settings);

    const now = new Date();
    console.log('Current Server Time:', now.toISOString());

    if (settings?.keeperDeadline) {
        console.log('Keeper Deadline:', settings.keeperDeadline.toISOString());
        console.log('Is Deadline Passed?', now > settings.keeperDeadline);
    }
}

checkSettings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
