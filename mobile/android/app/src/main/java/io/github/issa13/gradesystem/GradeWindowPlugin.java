package io.github.issa13.gradesystem;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Colours the strips behind the phone's status bar (top) and navigation bar
 * (bottom) so they match the page's light/dark theme. The page itself never
 * draws under those bars (see mobile/native/native-app.js), so these strips
 * show the window's own background colour.
 *
 * Called from JavaScript as Capacitor.Plugins.GradeWindow.setBackgroundColor({ color: "#18181b" }).
 */
@CapacitorPlugin(name = "GradeWindow")
public class GradeWindowPlugin extends Plugin {

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String color = call.getString("color");
        if (color == null) {
            call.reject("color is required");
            return;
        }
        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            call.reject("invalid color: " + color);
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().getDecorView().setBackgroundColor(parsed);
            call.resolve();
        });
    }
}
