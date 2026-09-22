CREATE TABLE "crm_tag_settings" (
	"key" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"color" varchar(7) NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tag_settings_key_check" CHECK ("crm_tag_settings"."key" in ('source:isaac', 'profile:dono', 'profile:gestor')),
	CONSTRAINT "crm_tag_settings_name_check" CHECK (length(trim("crm_tag_settings"."name")) > 0),
	CONSTRAINT "crm_tag_settings_color_check" CHECK ("crm_tag_settings"."color" ~ '^#[0-9a-fA-F]{6}$')
);
