using System.Text.Json.Serialization;
using Accounting.Api.Endpoints;
using Accounting.Domain.Enums;
using Accounting.Infrastructure;
using Accounting.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("AccountingDb")
    ?? throw new InvalidOperationException("Connection string 'AccountingDb' is not configured.");

builder.Services.AddAccountingInfrastructure(connectionString);
builder.Services.AddProblemDetails();

// Accounting enumerations travel as their domain names, matching how they are stored.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services
    .AddIdentityCore<IdentityUser>(options =>
    {
        // Framework-supported password hashing and lockout only; no custom cryptography (section 6.2).
        options.Password.RequiredLength = 12;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.User.RequireUniqueEmail = true;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<AccountingDbContext>()
    .AddApiEndpoints();

// Bearer tokens for API clients; cookies for the local browser UI (specification section 6.2).
builder.Services
    .AddAuthentication(IdentityConstants.BearerScheme)
    .AddBearerToken(IdentityConstants.BearerScheme)
    .AddIdentityCookies();
builder.Services.AddAuthorization();

var app = builder.Build();

await DatabaseInitializer.InitialiseAsync(app.Services);

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseAuthorization();

app.MapIdentityApi<IdentityUser>().WithTags("Identity");
app.MapEntityEndpoints();
app.MapJournalEndpoints();
app.MapReportingEndpoints();

app.MapGet("/api/v1/system/info", (IConfiguration config) => Results.Ok(new
{
    Application = "Local Accounting Platform",
    Version = typeof(Program).Assembly.GetName().Version?.ToString(),
    SchemaVersion = AccountingDbContext.AccountingSchemaVersion,
    Framework = "IFRS for SMEs",
})).AllowAnonymous();

app.Run();

/// <summary>Exposed so the integration test host can reference the API assembly.</summary>
public partial class Program;
