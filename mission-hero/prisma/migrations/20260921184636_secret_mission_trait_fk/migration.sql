-- AddForeignKey
ALTER TABLE "SecretMission" ADD CONSTRAINT "SecretMission_characterTraitId_fkey" FOREIGN KEY ("characterTraitId") REFERENCES "CharacterTrait"("id") ON DELETE SET NULL ON UPDATE CASCADE;
