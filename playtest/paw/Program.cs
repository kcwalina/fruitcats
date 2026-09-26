using mochi.playtester;
using Mochi.Paws;

// mochi-playtester runs Fruitcats playtests on PC2024 overnight: bot games on the CPU, LLM games through the
// local model node. It downloads the current playtest runner from the public game site, and keeps the playtest
// dashboard up to date through the Fruitcats API with a key of its own (DashboardSync.cs).

string configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".mochi");
string configFile = Path.Combine(configDir, "playtester.json");

if (!File.Exists(configFile))
{
    // Write the defaults out, so the schedule and paths are discoverable and editable.
    Directory.CreateDirectory(configDir);
    PlaytesterConfig defaults = new()
    {
        UserId = Environment.GetEnvironmentVariable("MOCHI_USERID") ?? "",
        HubUrl = Environment.GetEnvironmentVariable("MOCHI_HUBURL") ?? "https://www.viamochi.com",
    };
    SpecialistSetup.SaveConfigFile(configDir, configFile, defaults);
}

await UdsPaw.RunAsync<PlaytesterServer>(args);
