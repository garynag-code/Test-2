-- AlterTable
ALTER TABLE "SecretMission" ADD COLUMN     "requiresDiscovery" BOOLEAN NOT NULL DEFAULT true;

-- A bonus challenge is listed openly, so it needs no hidden object; a secret
-- mission is only findable if it has one.
ALTER TABLE "SecretMission"
  ADD CONSTRAINT "SecretMission_discovery_needs_object"
  CHECK ("requiresDiscovery" = false OR length(btrim("hiddenObjectKey")) > 0);
