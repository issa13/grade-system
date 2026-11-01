package io.github.issa13.gradesystem;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Our own small plugins — must be registered before super.onCreate().
        registerPlugin(GradeWindowPlugin.class); // colour behind the status / navigation bars
        registerPlugin(GradePrintPlugin.class);  // «طباعة / حفظ PDF»
        super.onCreate(savedInstanceState);
        // Serves each page's own index.html (see GradeWebViewClient.java).
        getBridge().setWebViewClient(new GradeWebViewClient(getBridge()));
    }
}
