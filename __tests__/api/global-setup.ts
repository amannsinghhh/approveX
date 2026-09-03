import { prepareDatabase } from '../support/prepare-database';
import { testDbUrls } from './db-urls';

/** Creates approvex_test if missing and applies all migrations. */
export default async function globalSetup(): Promise<void> {
  await prepareDatabase(testDbUrls().owner);
}
