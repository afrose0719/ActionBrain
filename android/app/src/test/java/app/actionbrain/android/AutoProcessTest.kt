package app.actionbrain.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutoProcessTest {
    @Test
    fun processAddressOnlyFromTheIntakeAddress() {
        assertEquals("https://actionbrain.example/api/intake/process", AutoProcess.processAddress("https://actionbrain.example/api/intake"))
        assertNull(AutoProcess.processAddress("http://actionbrain.example/api/intake"))
        assertNull(AutoProcess.processAddress("https://evil.example/collect"))
        assertNull(AutoProcess.processAddress("https://actionbrain.example/api/intake/x"))
    }

    @Test
    fun parsesOnlyStatusAndWaiting() {
        assertEquals(AutoProcess.Result("ok", 2), AutoProcess.parse("""{"status":"ok","processed":3,"added_tasks":1,"waiting":2}"""))
        assertEquals(AutoProcess.Result("off", 0), AutoProcess.parse("""{"status":"off"}"""))
        assertEquals(AutoProcess.Result("not_configured", 0), AutoProcess.parse("""{"status":"not_configured"}"""))
        assertEquals(AutoProcess.Result("unknown", 0), AutoProcess.parse("<html>proxy error</html>"))
    }
}
