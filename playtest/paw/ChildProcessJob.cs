using System.Diagnostics;
using System.Runtime.InteropServices;

namespace mochi.playtester;

/// <summary>
/// A Windows job object that kills everything inside it when this process goes away — the thing that
/// guarantees <c>node</c> (the playtest runner) can never outlive the paw that started it.
///
/// <para>Copied from mochi.jarvis, where the reason is written down: catsitter's graceful stop sweeps for
/// orphans <b>by the paw's own executable name</b>, so a child called <c>node.exe</c> is invisible to it.
/// An orphaned runner would keep playing through the night, holding CPU cores and keeping the model node
/// busy (and the GPU lease with it) after the paw was stopped. A job object with KILL_ON_JOB_CLOSE closes
/// that hole for every exit path at once — clean shutdown, unhandled exception, or an outright
/// <c>TerminateProcess</c> from the supervisor — because the kernel, not our code, does the killing when
/// the last handle closes.</para>
/// </summary>
sealed class ChildProcessJob : IDisposable
{
    const int ExtendedLimitInformationClass = 9;
    const uint JobObjectLimitKillOnJobClose = 0x2000;

    IntPtr _handle = IntPtr.Zero;

    public ChildProcessJob()
    {
        if (!OperatingSystem.IsWindows())
            return;

        _handle = CreateJobObject(IntPtr.Zero, null);
        if (_handle == IntPtr.Zero)
        {
            // Not fatal on its own — the paw still kills the child explicitly on shutdown — but it does
            // remove the guarantee that covers a force-kill, so it must be visible rather than silent.
            PawTrace($"CreateJobObject failed (win32 {Marshal.GetLastWin32Error()}); llama-server will not be kill-on-close protected");
            return;
        }

        JobObjectExtendedLimitInformation info = new();
        info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(info, buffer, fDeleteOld: false);
            if (!SetInformationJobObject(_handle, ExtendedLimitInformationClass, buffer, (uint)length))
                PawTrace($"SetInformationJobObject failed (win32 {Marshal.GetLastWin32Error()}); kill-on-close is NOT active");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>Puts a child in the job, so it dies when this process does.</summary>
    public void Adopt(Process child)
    {
        if (!OperatingSystem.IsWindows() || _handle == IntPtr.Zero)
            return;

        try
        {
            if (!AssignProcessToJobObject(_handle, child.Handle))
                PawTrace($"AssignProcessToJobObject failed (win32 {Marshal.GetLastWin32Error()}); child {child.Id} is not kill-on-close protected");
        }
        catch (Exception ex)
        {
            PawTrace($"Could not adopt child {child.Id} into the job object: {ex.GetType().Name}: {ex.Message}");
        }
    }

    public void Dispose()
    {
        if (_handle == IntPtr.Zero)
            return;

        // Closing the last handle is what kills the job's contents.
        CloseHandle(_handle);
        _handle = IntPtr.Zero;
    }

    static void PawTrace(string message) => Mochi.AgentService.PawEventSource.Instance.Warning(message);

    [StructLayout(LayoutKind.Sequential)]
    struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);
}
