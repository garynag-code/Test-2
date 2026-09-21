-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'PARENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "AgeBracket" AS ENUM ('AGE_6_8', 'AGE_9_11', 'AGE_12_14');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('PARENT', 'CHILD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TaskDifficulty" AS ENUM ('EASY', 'STANDARD', 'CHALLENGING', 'EPIC');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('NONE', 'PHOTO', 'NOTE', 'VOICE', 'PARENT_CONFIRM');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKDAYS', 'WEEKENDS', 'SELECTED_DAYS', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'MISSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_REDO', 'ASK_QUESTION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'QUESTION_ASKED');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('TASK_COMPLETION', 'DAILY_CHECK_IN', 'MEMORY_SUBMISSION', 'CHARACTER_APPROVAL', 'SECRET_MISSION', 'BONUS_CHALLENGE', 'STREAK_MILESTONE', 'ACHIEVEMENT', 'BADGE', 'LEVEL_UP', 'WHEEL_SPIN', 'REWARD_REDEMPTION', 'REDEMPTION_REFUND', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BadgeTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'DIAMOND');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('EXPERIENCE', 'PHYSICAL', 'PRIVILEGE', 'SCREEN_TIME', 'POCKET_MONEY', 'FOOD', 'PARENT_TIME', 'DIGITAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StreakKind" AS ENUM ('DAILY_CHECK_IN', 'ALL_DAILY_TASKS', 'TASK_GROUP', 'CHARACTER', 'MEMORY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('BIBLE_VERSE', 'QUOTE', 'AFFIRMATION', 'FAMILY_SAYING', 'SLOGAN', 'VOCABULARY', 'SCHOOL_FACT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemoryVerificationType" AS ENUM ('TYPED', 'PARENT_CONFIRM', 'VOICE');

-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "CollectibleType" AS ENUM ('PET', 'BACKGROUND', 'ROOM_ITEM', 'EFFECT', 'EMOTE', 'MAP_DECOR');

-- CreateEnum
CREATE TYPE "AvatarSlot" AS ENUM ('BASE', 'HAT', 'CAPE', 'CROWN', 'HELMET', 'GLASSES', 'PET', 'BACKGROUND', 'TRAIL');

-- CreateEnum
CREATE TYPE "NotificationRecipientType" AS ENUM ('PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_SUBMITTED', 'TASK_APPROVED', 'TASK_REJECTED', 'CHARACTER_SUBMITTED', 'CHARACTER_CONFIRMED', 'MEMORY_SUBMITTED', 'MEMORY_APPROVED', 'WHEEL_UNLOCKED', 'WHEEL_SPUN', 'REWARD_REQUESTED', 'REWARD_FULFILLED', 'BADGE_UNLOCKED', 'ACHIEVEMENT_UNLOCKED', 'LEVEL_UP', 'STREAK_MILESTONE', 'SECRET_MISSION_FOUND', 'ENCOURAGEMENT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('FAMILY_CREATED', 'FAMILY_SETTINGS_CHANGED', 'CHILD_CREATED', 'CHILD_UPDATED', 'CHILD_ARCHIVED', 'PARENT_INVITED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'COMPLETION_SUBMITTED', 'COMPLETION_APPROVED', 'COMPLETION_REJECTED', 'COMPLETION_REDO_REQUESTED', 'CHECK_IN_RECORDED', 'CHARACTER_TRAIT_CREATED', 'CHARACTER_TRAIT_UPDATED', 'CHARACTER_SUBMITTED', 'CHARACTER_APPROVED', 'CHARACTER_REJECTED', 'MEMORY_CHALLENGE_CREATED', 'MEMORY_SUBMITTED', 'MEMORY_APPROVED', 'MEMORY_REJECTED', 'SECRET_MISSION_CREATED', 'SECRET_MISSION_DISCOVERED', 'SECRET_MISSION_APPROVED', 'REWARD_CREATED', 'REWARD_UPDATED', 'REWARD_REDEEMED', 'REDEMPTION_RESOLVED', 'WHEEL_CONFIGURED', 'WHEEL_SPUN', 'POINTS_AWARDED', 'POINTS_DEDUCTED', 'MANUAL_ADJUSTMENT', 'BADGE_UNLOCKED', 'ACHIEVEMENT_UNLOCKED', 'PROFILE_CHANGED', 'SETTINGS_CHANGED', 'PIN_CHANGED', 'PIN_LOCKED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "currencyCode" TEXT NOT NULL DEFAULT 'ZAR',
    "familyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL DEFAULT 'PARENT',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentProfile" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarKey" TEXT NOT NULL DEFAULT 'parent-1',
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildProfile" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "ageBracket" "AgeBracket" NOT NULL DEFAULT 'AGE_9_11',
    "birthMonth" INTEGER,
    "birthYear" INTEGER,
    "avatarKey" TEXT NOT NULL DEFAULT 'hero-1',
    "themeKey" TEXT NOT NULL DEFAULT 'space',
    "pinHash" TEXT,
    "pinRequired" BOOLEAN NOT NULL DEFAULT false,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "status" "ChildStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChildProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCategory" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'star',
    "colorKey" TEXT NOT NULL DEFAULT 'brand',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "iconKey" TEXT NOT NULL DEFAULT 'target',
    "colorKey" TEXT NOT NULL DEFAULT 'brand',
    "xpValue" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsValue" INTEGER NOT NULL DEFAULT 0,
    "characterTraitId" TEXT,
    "characterStarValue" INTEGER NOT NULL DEFAULT 0,
    "difficulty" "TaskDifficulty" NOT NULL DEFAULT 'STANDARD',
    "evidenceType" "EvidenceType" NOT NULL DEFAULT 'NONE',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "streakEligible" BOOLEAN NOT NULL DEFAULT true,
    "isFamilyTask" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSchedule" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'DAILY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "monthDay" INTEGER,
    "month" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "dueTime" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCompletion" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'PENDING',
    "childNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskApproval" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "parentUserId" TEXT,
    "decision" "ApprovalDecision" NOT NULL,
    "encouragementMessage" TEXT,
    "question" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "starsAwarded" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvidence" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "durationMs" INTEGER,
    "textBody" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpTransaction" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" "LedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "awardedByUserId" TEXT,
    "reason" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPointsTransaction" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" "LedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "awardedByUserId" TEXT,
    "reason" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardPointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterStarTransaction" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "traitId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" "LedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "awardedByUserId" TEXT,
    "reason" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterStarTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterTrait" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '⭐',
    "colorKey" TEXT NOT NULL DEFAULT 'star',
    "description" TEXT,
    "promptText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CharacterTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSubmission" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "traitId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "story" TEXT NOT NULL,
    "mood" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterApproval" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "parentUserId" TEXT,
    "decision" "ApprovalDecision" NOT NULL,
    "encouragementMessage" TEXT,
    "question" TEXT,
    "starsAwarded" INTEGER NOT NULL DEFAULT 0,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterBadge" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "traitId" TEXT,
    "name" TEXT NOT NULL,
    "tier" "BadgeTier" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'medal',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterBadgeProgress" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterBadgeProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardCategory" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'gift',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "RewardType" NOT NULL DEFAULT 'CUSTOM',
    "iconKey" TEXT NOT NULL DEFAULT 'gift',
    "imageKey" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "inventoryQuantity" INTEGER,
    "requiresParentApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEligibility" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardWheel" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Reward Wheel',
    "pointThreshold" INTEGER NOT NULL DEFAULT 100,
    "deductPoints" BOOLEAN NOT NULL DEFAULT true,
    "pointsCost" INTEGER NOT NULL DEFAULT 100,
    "spinsPerDay" INTEGER NOT NULL DEFAULT 1,
    "spinsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardWheel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardWheelItem" (
    "id" TEXT NOT NULL,
    "wheelId" TEXT NOT NULL,
    "rewardId" TEXT,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "iconKey" TEXT NOT NULL DEFAULT 'gift',
    "colorKey" TEXT NOT NULL DEFAULT 'brand',
    "segmentIndex" INTEGER NOT NULL,
    "maxWinsPerChild" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardWheelItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardSpin" (
    "id" TEXT NOT NULL,
    "wheelId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "wheelItemId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "localDate" DATE NOT NULL,
    "resultRevealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardSpin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "mood" TEXT,
    "goalText" TEXT,
    "gratitudeText" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryChallenge" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL DEFAULT 'CUSTOM',
    "reference" TEXT,
    "bodyText" TEXT NOT NULL,
    "xpValue" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsValue" INTEGER NOT NULL DEFAULT 0,
    "verificationType" "MemoryVerificationType" NOT NULL DEFAULT 'TYPED',
    "startDate" DATE,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MemoryChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryChallengeAssignment" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryChallengeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorySubmission" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "recitedText" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemorySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryApproval" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "parentUserId" TEXT,
    "decision" "ApprovalDecision" NOT NULL,
    "encouragementMessage" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretMission" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "xpValue" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsValue" INTEGER NOT NULL DEFAULT 0,
    "characterTraitId" TEXT,
    "starValue" INTEGER NOT NULL DEFAULT 0,
    "grantsWheelSpin" BOOLEAN NOT NULL DEFAULT false,
    "hiddenObjectKey" TEXT NOT NULL DEFAULT 'chest',
    "availableFrom" DATE,
    "availableTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SecretMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretMissionDiscovery" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "hiddenObjectKey" TEXT NOT NULL,
    "surfaceKey" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretMissionDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretMissionSubmission" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childNote" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "parentUserId" TEXT,
    "encouragementMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretMissionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minLifetimeXp" INTEGER NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'star',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streak" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "kind" "StreakKind" NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "longestCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" DATE,
    "startedDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'trophy',
    "ruleType" TEXT NOT NULL,
    "ruleConfig" JSONB NOT NULL DEFAULT '{}',
    "xpValue" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsValue" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementUnlock" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconKey" TEXT NOT NULL DEFAULT 'medal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeUnlock" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalCollectible" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CollectibleType" NOT NULL DEFAULT 'PET',
    "iconKey" TEXT NOT NULL DEFAULT 'sparkles',
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "unlockRule" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalCollectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildCollectible" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "collectibleId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildCollectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarItem" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" "AvatarSlot" NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'hat',
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "unlockRule" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildAvatarItem" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "avatarItemId" TEXT NOT NULL,
    "slot" "AvatarSlot" NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildAvatarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySetting" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "mediaUploadsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "photoEvidenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "voiceNotesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wheelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "secretMissionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hiddenObjectsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "characterVerificationRequired" BOOLEAN NOT NULL DEFAULT true,
    "characterXpPerStar" INTEGER NOT NULL DEFAULT 5,
    "checkInXp" INTEGER NOT NULL DEFAULT 5,
    "checkInPoints" INTEGER NOT NULL DEFAULT 0,
    "weeklyGoalTarget" INTEGER NOT NULL DEFAULT 25,
    "parentGateTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildSetting" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "pinRequired" BOOLEAN NOT NULL DEFAULT false,
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "characterAutoApprove" BOOLEAN NOT NULL DEFAULT false,
    "dailyTaskTarget" INTEGER NOT NULL DEFAULT 4,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "recipientType" "NotificationRecipientType" NOT NULL,
    "recipientUserId" TEXT,
    "recipientChildId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorChildId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Family_familyCode_key" ON "Family"("familyCode");

-- CreateIndex
CREATE INDEX "FamilyMember_userId_status_idx" ON "FamilyMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_familyId_userId_key" ON "FamilyMember"("familyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentProfile_familyId_userId_key" ON "ParentProfile"("familyId", "userId");

-- CreateIndex
CREATE INDEX "ChildProfile_familyId_status_idx" ON "ChildProfile"("familyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChildProfile_familyId_nickname_key" ON "ChildProfile"("familyId", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCategory_familyId_key_key" ON "TaskCategory"("familyId", "key");

-- CreateIndex
CREATE INDEX "Task_familyId_active_idx" ON "Task"("familyId", "active");

-- CreateIndex
CREATE INDEX "TaskAssignment_childId_active_idx" ON "TaskAssignment"("childId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_childId_key" ON "TaskAssignment"("taskId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSchedule_taskId_key" ON "TaskSchedule"("taskId");

-- CreateIndex
CREATE INDEX "TaskOccurrence_childId_occurrenceDate_idx" ON "TaskOccurrence"("childId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "TaskOccurrence_familyId_status_idx" ON "TaskOccurrence"("familyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskId_childId_occurrenceDate_key" ON "TaskOccurrence"("taskId", "childId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "TaskCompletion_familyId_status_submittedAt_idx" ON "TaskCompletion"("familyId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "TaskCompletion_childId_status_idx" ON "TaskCompletion"("childId", "status");

-- CreateIndex
CREATE INDEX "TaskApproval_completionId_idx" ON "TaskApproval"("completionId");

-- CreateIndex
CREATE INDEX "TaskEvidence_completionId_idx" ON "TaskEvidence"("completionId");

-- CreateIndex
CREATE INDEX "TaskEvidence_familyId_idx" ON "TaskEvidence"("familyId");

-- CreateIndex
CREATE INDEX "XpTransaction_childId_createdAt_idx" ON "XpTransaction"("childId", "createdAt");

-- CreateIndex
CREATE INDEX "XpTransaction_sourceType_sourceId_idx" ON "XpTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_childId_idempotencyKey_key" ON "XpTransaction"("childId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardPointsTransaction_childId_createdAt_idx" ON "RewardPointsTransaction"("childId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardPointsTransaction_sourceType_sourceId_idx" ON "RewardPointsTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPointsTransaction_childId_idempotencyKey_key" ON "RewardPointsTransaction"("childId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CharacterStarTransaction_childId_traitId_idx" ON "CharacterStarTransaction"("childId", "traitId");

-- CreateIndex
CREATE INDEX "CharacterStarTransaction_childId_createdAt_idx" ON "CharacterStarTransaction"("childId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterStarTransaction_childId_idempotencyKey_key" ON "CharacterStarTransaction"("childId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CharacterTrait_familyId_active_idx" ON "CharacterTrait"("familyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterTrait_familyId_key_key" ON "CharacterTrait"("familyId", "key");

-- CreateIndex
CREATE INDEX "CharacterSubmission_familyId_status_submittedAt_idx" ON "CharacterSubmission"("familyId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "CharacterSubmission_childId_localDate_idx" ON "CharacterSubmission"("childId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterApproval_submissionId_key" ON "CharacterApproval"("submissionId");

-- CreateIndex
CREATE INDEX "CharacterBadge_familyId_active_idx" ON "CharacterBadge"("familyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterBadge_familyId_traitId_tier_key" ON "CharacterBadge"("familyId", "traitId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterBadgeProgress_childId_badgeId_key" ON "CharacterBadgeProgress"("childId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCategory_familyId_key_key" ON "RewardCategory"("familyId", "key");

-- CreateIndex
CREATE INDEX "Reward_familyId_active_idx" ON "Reward"("familyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEligibility_rewardId_childId_key" ON "RewardEligibility"("rewardId", "childId");

-- CreateIndex
CREATE INDEX "RewardRedemption_familyId_status_idx" ON "RewardRedemption"("familyId", "status");

-- CreateIndex
CREATE INDEX "RewardRedemption_childId_requestedAt_idx" ON "RewardRedemption"("childId", "requestedAt");

-- CreateIndex
CREATE INDEX "RewardWheel_familyId_active_idx" ON "RewardWheel"("familyId", "active");

-- CreateIndex
CREATE INDEX "RewardWheelItem_wheelId_active_idx" ON "RewardWheelItem"("wheelId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RewardWheelItem_wheelId_segmentIndex_key" ON "RewardWheelItem"("wheelId", "segmentIndex");

-- CreateIndex
CREATE INDEX "RewardSpin_childId_createdAt_idx" ON "RewardSpin"("childId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardSpin_childId_localDate_idx" ON "RewardSpin"("childId", "localDate");

-- CreateIndex
CREATE INDEX "RewardSpin_familyId_createdAt_idx" ON "RewardSpin"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "DailyCheckIn_familyId_localDate_idx" ON "DailyCheckIn"("familyId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckIn_childId_localDate_key" ON "DailyCheckIn"("childId", "localDate");

-- CreateIndex
CREATE INDEX "MemoryChallenge_familyId_active_idx" ON "MemoryChallenge"("familyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryChallengeAssignment_challengeId_childId_key" ON "MemoryChallengeAssignment"("challengeId", "childId");

-- CreateIndex
CREATE INDEX "MemorySubmission_familyId_status_idx" ON "MemorySubmission"("familyId", "status");

-- CreateIndex
CREATE INDEX "MemorySubmission_childId_challengeId_idx" ON "MemorySubmission"("childId", "challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryApproval_submissionId_key" ON "MemoryApproval"("submissionId");

-- CreateIndex
CREATE INDEX "SecretMission_familyId_active_idx" ON "SecretMission"("familyId", "active");

-- CreateIndex
CREATE INDEX "SecretMissionDiscovery_childId_discoveredAt_idx" ON "SecretMissionDiscovery"("childId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecretMissionDiscovery_childId_missionId_key" ON "SecretMissionDiscovery"("childId", "missionId");

-- CreateIndex
CREATE INDEX "SecretMissionSubmission_familyId_status_idx" ON "SecretMissionSubmission"("familyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SecretMissionSubmission_childId_missionId_key" ON "SecretMissionSubmission"("childId", "missionId");

-- CreateIndex
CREATE INDEX "Level_familyId_minLifetimeXp_idx" ON "Level"("familyId", "minLifetimeXp");

-- CreateIndex
CREATE UNIQUE INDEX "Level_familyId_levelNumber_key" ON "Level"("familyId", "levelNumber");

-- CreateIndex
CREATE INDEX "Streak_familyId_kind_idx" ON "Streak"("familyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Streak_childId_kind_key_key" ON "Streak"("childId", "kind", "key");

-- CreateIndex
CREATE INDEX "Achievement_familyId_active_idx" ON "Achievement"("familyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_familyId_key_key" ON "Achievement"("familyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementUnlock_childId_achievementId_key" ON "AchievementUnlock"("childId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_familyId_key_key" ON "Badge"("familyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeUnlock_childId_badgeId_key" ON "BadgeUnlock"("childId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCollectible_familyId_key_key" ON "DigitalCollectible"("familyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ChildCollectible_childId_collectibleId_key" ON "ChildCollectible"("childId", "collectibleId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarItem_familyId_key_key" ON "AvatarItem"("familyId", "key");

-- CreateIndex
CREATE INDEX "ChildAvatarItem_childId_slot_idx" ON "ChildAvatarItem"("childId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "ChildAvatarItem_childId_avatarItemId_key" ON "ChildAvatarItem"("childId", "avatarItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilySetting_familyId_key" ON "FamilySetting"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChildSetting_childId_key" ON "ChildSetting"("childId");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_idx" ON "Notification"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientChildId_readAt_idx" ON "Notification"("recipientChildId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_familyId_createdAt_idx" ON "Notification"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentProfile" ADD CONSTRAINT "ParentProfile_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentProfile" ADD CONSTRAINT "ParentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildProfile" ADD CONSTRAINT "ChildProfile_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCategory" ADD CONSTRAINT "TaskCategory_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TaskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_characterTraitId_fkey" FOREIGN KEY ("characterTraitId") REFERENCES "CharacterTrait"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSchedule" ADD CONSTRAINT "TaskSchedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskApproval" ADD CONSTRAINT "TaskApproval_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "TaskCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "TaskCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardPointsTransaction" ADD CONSTRAINT "RewardPointsTransaction_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardPointsTransaction" ADD CONSTRAINT "RewardPointsTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterStarTransaction" ADD CONSTRAINT "CharacterStarTransaction_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterStarTransaction" ADD CONSTRAINT "CharacterStarTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterStarTransaction" ADD CONSTRAINT "CharacterStarTransaction_traitId_fkey" FOREIGN KEY ("traitId") REFERENCES "CharacterTrait"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTrait" ADD CONSTRAINT "CharacterTrait_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSubmission" ADD CONSTRAINT "CharacterSubmission_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSubmission" ADD CONSTRAINT "CharacterSubmission_traitId_fkey" FOREIGN KEY ("traitId") REFERENCES "CharacterTrait"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterApproval" ADD CONSTRAINT "CharacterApproval_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CharacterSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBadge" ADD CONSTRAINT "CharacterBadge_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBadge" ADD CONSTRAINT "CharacterBadge_traitId_fkey" FOREIGN KEY ("traitId") REFERENCES "CharacterTrait"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBadgeProgress" ADD CONSTRAINT "CharacterBadgeProgress_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBadgeProgress" ADD CONSTRAINT "CharacterBadgeProgress_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "CharacterBadge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardCategory" ADD CONSTRAINT "RewardCategory_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RewardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEligibility" ADD CONSTRAINT "RewardEligibility_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEligibility" ADD CONSTRAINT "RewardEligibility_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardWheel" ADD CONSTRAINT "RewardWheel_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardWheelItem" ADD CONSTRAINT "RewardWheelItem_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "RewardWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardWheelItem" ADD CONSTRAINT "RewardWheelItem_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSpin" ADD CONSTRAINT "RewardSpin_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "RewardWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSpin" ADD CONSTRAINT "RewardSpin_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSpin" ADD CONSTRAINT "RewardSpin_wheelItemId_fkey" FOREIGN KEY ("wheelItemId") REFERENCES "RewardWheelItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryChallenge" ADD CONSTRAINT "MemoryChallenge_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryChallengeAssignment" ADD CONSTRAINT "MemoryChallengeAssignment_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "MemoryChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryChallengeAssignment" ADD CONSTRAINT "MemoryChallengeAssignment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySubmission" ADD CONSTRAINT "MemorySubmission_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "MemoryChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySubmission" ADD CONSTRAINT "MemorySubmission_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryApproval" ADD CONSTRAINT "MemoryApproval_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "MemorySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretMission" ADD CONSTRAINT "SecretMission_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretMissionDiscovery" ADD CONSTRAINT "SecretMissionDiscovery_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SecretMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretMissionDiscovery" ADD CONSTRAINT "SecretMissionDiscovery_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretMissionSubmission" ADD CONSTRAINT "SecretMissionSubmission_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SecretMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretMissionSubmission" ADD CONSTRAINT "SecretMissionSubmission_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeUnlock" ADD CONSTRAINT "BadgeUnlock_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeUnlock" ADD CONSTRAINT "BadgeUnlock_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCollectible" ADD CONSTRAINT "DigitalCollectible_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildCollectible" ADD CONSTRAINT "ChildCollectible_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildCollectible" ADD CONSTRAINT "ChildCollectible_collectibleId_fkey" FOREIGN KEY ("collectibleId") REFERENCES "DigitalCollectible"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarItem" ADD CONSTRAINT "AvatarItem_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAvatarItem" ADD CONSTRAINT "ChildAvatarItem_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAvatarItem" ADD CONSTRAINT "ChildAvatarItem_avatarItemId_fkey" FOREIGN KEY ("avatarItemId") REFERENCES "AvatarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilySetting" ADD CONSTRAINT "FamilySetting_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildSetting" ADD CONSTRAINT "ChildSetting_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientChildId_fkey" FOREIGN KEY ("recipientChildId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorChildId_fkey" FOREIGN KEY ("actorChildId") REFERENCES "ChildProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Invariants that Prisma cannot express.
-- These are the last line of defence behind the service layer; every one of
-- them is also covered by a behavioural test (docs/08-test-strategy.md).
-- ===========================================================================

-- BR-3: XP may only ever be added, so lifetime XP is monotonic by construction.
ALTER TABLE "XpTransaction"
  ADD CONSTRAINT "XpTransaction_amount_positive" CHECK ("amount" > 0);

-- BR-5 / ADR-004: Character Stars are recognition, never currency. No debits.
ALTER TABLE "CharacterStarTransaction"
  ADD CONSTRAINT "CharacterStarTransaction_amount_positive" CHECK ("amount" > 0);

-- BR-4: Reward Points are spendable, so negatives are allowed — but a
-- zero-value ledger row is always a bug.
ALTER TABLE "RewardPointsTransaction"
  ADD CONSTRAINT "RewardPointsTransaction_amount_nonzero" CHECK ("amount" <> 0);

-- BR-8: a task must be worth something.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_values_nonnegative"
  CHECK ("xpValue" >= 0 AND "rewardPointsValue" >= 0 AND "characterStarValue" >= 0);
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_values_meaningful"
  CHECK ("xpValue" + "rewardPointsValue" + "characterStarValue" > 0);

-- BR-45: a zero or negative weight would make the weighted draw undefined.
ALTER TABLE "RewardWheelItem"
  ADD CONSTRAINT "RewardWheelItem_weight_positive" CHECK ("weight" >= 1);

-- Rewards cannot cost negative points, and stock cannot go negative.
ALTER TABLE "Reward"
  ADD CONSTRAINT "Reward_pointsCost_nonnegative" CHECK ("pointsCost" >= 0);
ALTER TABLE "Reward"
  ADD CONSTRAINT "Reward_inventory_nonnegative"
  CHECK ("inventoryQuantity" IS NULL OR "inventoryQuantity" >= 0);

-- Streak counters are never negative and the best is never below the current.
ALTER TABLE "Streak"
  ADD CONSTRAINT "Streak_counts_sane"
  CHECK ("currentCount" >= 0 AND "longestCount" >= "currentCount");

-- A PIN, when set, is stored hashed; a child requiring a PIN must have one.
ALTER TABLE "ChildProfile"
  ADD CONSTRAINT "ChildProfile_pin_present_when_required"
  CHECK ("pinRequired" = false OR "pinHash" IS NOT NULL);

-- Privacy (brief §40): we store month + year at most, never a full date of birth.
ALTER TABLE "ChildProfile"
  ADD CONSTRAINT "ChildProfile_birthMonth_range"
  CHECK ("birthMonth" IS NULL OR ("birthMonth" >= 1 AND "birthMonth" <= 12));

-- A recurrence interval of zero would loop forever during expansion.
ALTER TABLE "TaskSchedule"
  ADD CONSTRAINT "TaskSchedule_interval_positive" CHECK ("interval" >= 1);
ALTER TABLE "TaskSchedule"
  ADD CONSTRAINT "TaskSchedule_dates_ordered"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- BR-49: a memory challenge pays out at most once per child, ever.
CREATE UNIQUE INDEX "MemorySubmission_one_approval_per_child"
  ON "MemorySubmission" ("challengeId", "childId")
  WHERE "status" = 'APPROVED';

-- One equipped item per avatar slot per child.
CREATE UNIQUE INDEX "ChildAvatarItem_one_equipped_per_slot"
  ON "ChildAvatarItem" ("childId", "slot")
  WHERE "equipped" = true;

-- BR-9: at most one live (non-terminal) completion per occurrence.
CREATE UNIQUE INDEX "TaskCompletion_one_live_per_occurrence"
  ON "TaskCompletion" ("occurrenceId")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- A notification is addressed to exactly one recipient.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_single_recipient"
  CHECK (
    ("recipientType" = 'PARENT' AND "recipientUserId" IS NOT NULL AND "recipientChildId" IS NULL)
    OR
    ("recipientType" = 'CHILD' AND "recipientChildId" IS NOT NULL AND "recipientUserId" IS NULL)
  );

-- BR-7: a manual adjustment must say why.
ALTER TABLE "RewardPointsTransaction"
  ADD CONSTRAINT "RewardPointsTransaction_manual_needs_reason"
  CHECK ("sourceType" <> 'MANUAL_ADJUSTMENT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));
ALTER TABLE "XpTransaction"
  ADD CONSTRAINT "XpTransaction_manual_needs_reason"
  CHECK ("sourceType" <> 'MANUAL_ADJUSTMENT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));
ALTER TABLE "CharacterStarTransaction"
  ADD CONSTRAINT "CharacterStarTransaction_manual_needs_reason"
  CHECK ("sourceType" <> 'MANUAL_ADJUSTMENT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));
