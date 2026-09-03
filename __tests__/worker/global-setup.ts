import { prepareDatabase } from '../support/prepare-database';
import { testDbUrl } from './db-url';

/** Creates approvex_worker_test if missing and applies the API's migrations. */
export default async function globalSetup(): Promise<void> {
  await prepareDatabase(testDbUrl());
}
