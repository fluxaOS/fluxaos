ALTER TABLE "harness_catalog" RENAME TO "driver";
--> statement-breakpoint
ALTER TABLE "pipeline_stage" RENAME COLUMN "harness_id" TO "driver_id";
--> statement-breakpoint
ALTER TABLE "pipeline_stage" RENAME COLUMN "harness" TO "driver";
--> statement-breakpoint
ALTER TABLE "stage_run" RENAME COLUMN "harness_id" TO "driver_id";
--> statement-breakpoint
ALTER TABLE "stage_run" RENAME COLUMN "harness" TO "driver";
--> statement-breakpoint
ALTER TABLE "routing_rule" RENAME COLUMN "preferred_harness" TO "preferred_driver";
--> statement-breakpoint
ALTER TABLE "routing_rule" RENAME COLUMN "fallback_harness" TO "fallback_driver";
