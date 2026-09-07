using System.Text.Json.Nodes;
using Xunit;

namespace TokenTrackerWin;

public sealed class AutoUpdatePolicyTests
{
    [Fact]
    public void MissingPreferenceKeepsAutomaticUpdatesEnabled()
    {
        Assert.True(AutoUpdatePolicy.ResolveEnabled(new JsonObject()));
    }

    [Fact]
    public void PersistedPreferenceCanDisableAutomaticUpdates()
    {
        var settings = new JsonObject
        {
            [AutoUpdatePolicy.EnabledKey] = false,
        };

        Assert.False(AutoUpdatePolicy.ResolveEnabled(settings));
    }

    [Fact]
    public void PersistedPreferenceCanEnableAutomaticUpdates()
    {
        var settings = new JsonObject
        {
            [AutoUpdatePolicy.EnabledKey] = true,
        };

        Assert.True(AutoUpdatePolicy.ResolveEnabled(settings));
    }

    [Fact]
    public void MalformedPreferenceFallsBackToEnabled()
    {
        var settings = new JsonObject
        {
            // An older build could persist the value as a string; that is not
            // a user decision, so the default stays enabled.
            [AutoUpdatePolicy.EnabledKey] = "false",
        };

        Assert.True(AutoUpdatePolicy.ResolveEnabled(settings));
    }
}
