import ctypes
import ctypes.util
import gc

# glibc keeps memory a thread freed in that thread's arena instead of giving it back, so after a
# burst of downloads (each with its own fragment threads) the process stays hundreds of MB big
try:
    _libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6")
    _malloc_trim = _libc.malloc_trim
except (OSError, AttributeError):
    # Not glibc (musl, macOS): nothing to trim
    _malloc_trim = None


def release_memory():
    """Free Python's garbage, then hand the free pages of every malloc arena back to the OS."""
    gc.collect()
    if _malloc_trim is not None:
        _malloc_trim(0)
