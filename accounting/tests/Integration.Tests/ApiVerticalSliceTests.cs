using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Accounting.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Integration.Tests;

public sealed class ApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:AccountingDb"] = connectionString,
        }));
        return base.CreateHost(builder);
    }
}

/// <summary>
/// The first demonstrable vertical slice from specification section 31.1:
/// create entity, create accounts, post a balanced journal, read the trial balance, reverse, read it again.
/// Also covers SEC-AC-001 over HTTP.
/// </summary>
[Collection("database")]
public class ApiVerticalSliceTests(DatabaseFixture fixture) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public Task InitializeAsync()
    {
        _factory = new ApiFactory(fixture.ConnectionString);
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Entity_to_trial_balance_to_reversal_round_trip()
    {
        var admin = await CreateUserAsync(Roles.FirmAdmin);
        var client = await SignInAsync(admin.Email, admin.Password);

        var created = await client.PostAsJsonAsync("/api/v1/entities", new
        {
            LegalName = $"Vertical Slice {Guid.NewGuid():N}"[..28],
            OpeningFiscalYearEndingIn = 2027,
            IsVatVendor = true,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var entityId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var accounts = await client.GetFromJsonAsync<JsonElement>($"/api/v1/entities/{entityId}/accounts");
        var accountIds = accounts.EnumerateArray()
            .ToDictionary(a => a.GetProperty("code").GetString()!, a => a.GetProperty("id").GetGuid());
        Assert.Contains("1000", accountIds.Keys);

        var draft = await client.PostAsJsonAsync($"/api/v1/entities/{entityId}/journals", new
        {
            TransactionDate = "2026-06-30",
            JournalType = "GEN",
            Description = "Consulting fee income",
            Lines = new[]
            {
                new { AccountId = accountIds["1000"], DebitAmount = 5000m, CreditAmount = 0m },
                new { AccountId = accountIds["4000"], DebitAmount = 0m, CreditAmount = 5000m },
            },
        });
        Assert.Equal(HttpStatusCode.OK, draft.StatusCode);
        var journalId = (await draft.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("journalId").GetGuid();

        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsync($"/api/v1/journals/{journalId}/validate", null)).StatusCode);

        var posted = await client.PostAsync($"/api/v1/journals/{journalId}/post", null);
        Assert.Equal(HttpStatusCode.OK, posted.StatusCode);
        var journalNumber = (await posted.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("journalNumber").GetString();
        Assert.StartsWith("GEN-", journalNumber);

        var tb = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/entities/{entityId}/trial-balance?fromDate=2026-03-01&toDate=2027-02-28");
        Assert.True(tb.GetProperty("isBalanced").GetBoolean());
        Assert.Equal(5000m, tb.GetProperty("totalDebit").GetDecimal());

        var reversed = await client.PostAsJsonAsync($"/api/v1/journals/{journalId}/reverse", new
        {
            ReversalDate = "2026-07-31",
            Reason = "Posted to the wrong entity",
        });
        Assert.Equal(HttpStatusCode.OK, reversed.StatusCode);

        var tbAfter = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/entities/{entityId}/trial-balance?fromDate=2026-03-01&toDate=2027-02-28");
        Assert.Equal(0m, tbAfter.GetProperty("totalDebit").GetDecimal());
        Assert.True(tbAfter.GetProperty("isBalanced").GetBoolean());

        // The reversal did not erase history: both journals remain.
        var original = await client.GetFromJsonAsync<JsonElement>($"/api/v1/journals/{journalId}");
        Assert.Equal("Reversed", original.GetProperty("status").GetString());
        Assert.Equal(2, original.GetProperty("lines").GetArrayLength());
    }

    /// <summary>SEC-AC-001: a user without entity access receives 403 even knowing the record UUID.</summary>
    [Fact]
    public async Task User_without_entity_access_is_refused_by_the_api()
    {
        var admin = await CreateUserAsync(Roles.FirmAdmin);
        var adminClient = await SignInAsync(admin.Email, admin.Password);

        var created = await adminClient.PostAsJsonAsync("/api/v1/entities", new
        {
            LegalName = $"Private Client {Guid.NewGuid():N}"[..28],
            OpeningFiscalYearEndingIn = 2027,
        });
        var entityId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var outsider = await CreateUserAsync(Roles.Preparer);
        var outsiderClient = await SignInAsync(outsider.Email, outsider.Password);

        var accounts = await outsiderClient.GetAsync($"/api/v1/entities/{entityId}/accounts");
        var trialBalance = await outsiderClient.GetAsync(
            $"/api/v1/entities/{entityId}/trial-balance?fromDate=2026-03-01&toDate=2027-02-28");
        var journal = await outsiderClient.PostAsJsonAsync($"/api/v1/entities/{entityId}/journals", new
        {
            TransactionDate = "2026-06-30",
            JournalType = "GEN",
            Lines = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.Forbidden, accounts.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, trialBalance.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, journal.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_requests_are_refused()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync($"/api/v1/entities/{Guid.NewGuid()}/accounts");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>An entity-scoped grant gives access to that entity and no other.</summary>
    [Fact]
    public async Task Entity_scoped_grant_admits_the_user_to_only_that_entity()
    {
        var admin = await CreateUserAsync(Roles.FirmAdmin);
        var adminClient = await SignInAsync(admin.Email, admin.Password);

        async Task<Guid> CreateEntityAsync()
        {
            var response = await adminClient.PostAsJsonAsync("/api/v1/entities", new
            {
                LegalName = $"Client {Guid.NewGuid():N}"[..26],
                OpeningFiscalYearEndingIn = 2027,
            });
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        }

        var granted = await CreateEntityAsync();
        var withheld = await CreateEntityAsync();

        var preparer = await CreateUserAsync(Roles.Preparer);
        await using (var db = fixture.CreateContext())
        {
            db.EntityUserAccess.Add(new EntityUserAccess
            {
                EntityId = granted,
                UserId = preparer.Id,
                Role = Roles.Preparer,
            });
            await db.SaveChangesAsync();
        }

        var client = await SignInAsync(preparer.Email, preparer.Password);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/entities/{granted}/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/api/v1/entities/{withheld}/accounts")).StatusCode);
    }

    private async Task<(string Id, string Email, string Password)> CreateUserAsync(string role)
    {
        using var scope = _factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();

        if (!await roles.RoleExistsAsync(role)) await roles.CreateAsync(new IdentityRole(role));

        var email = $"{Guid.NewGuid():N}@example.test";
        const string password = "Integration-Test-1!";
        var user = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true };

        var created = await users.CreateAsync(user, password);
        Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
        await users.AddToRoleAsync(user, role);

        return (user.Id, email, password);
    }

    private async Task<HttpClient> SignInAsync(string email, string password)
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/login", new { email, password });
        response.EnsureSuccessStatusCode();

        var token = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }
}
