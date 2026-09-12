using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounting.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllocationRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "allocation_rules",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    sequence = table.Column<int>(type: "integer", nullable: false),
                    match_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    match_text = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    bank_account_id = table.Column<Guid>(type: "uuid", nullable: true),
                    applies_to_money_in = table.Column<bool>(type: "boolean", nullable: true),
                    account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    vat_code_id = table.Column<Guid>(type: "uuid", nullable: true),
                    no_vat_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    confidence = table.Column<int>(type: "integer", nullable: false),
                    times_applied = table.Column<int>(type: "integer", nullable: false),
                    times_overridden = table.Column<int>(type: "integer", nullable: false),
                    last_applied_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_allocation_rules", x => x.id);
                    table.ForeignKey(
                        name: "fk_allocation_rules__vat_codes_vat_code_id",
                        column: x => x.vat_code_id,
                        principalTable: "vat_codes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_allocation_rules_accounts_account_id",
                        column: x => x.account_id,
                        principalTable: "accounts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_allocation_rules_account_id",
                table: "allocation_rules",
                column: "account_id");

            migrationBuilder.CreateIndex(
                name: "IX_allocation_rules_entity_id_name",
                table: "allocation_rules",
                columns: new[] { "entity_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_allocation_rules_entity_id_sequence",
                table: "allocation_rules",
                columns: new[] { "entity_id", "sequence" });

            migrationBuilder.CreateIndex(
                name: "ix_allocation_rules_vat_code_id",
                table: "allocation_rules",
                column: "vat_code_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "allocation_rules");
        }
    }
}
