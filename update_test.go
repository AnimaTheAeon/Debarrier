package main

import "testing"

func TestIsNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.0.2", "1.0.1", true}, {"v1.1.0", "1.0.9", true}, {"1.0.10", "1.0.9", true},
		{"1.0.1", "1.0.1", false}, {"1.0.0", "1.0.1", false}, {"1.0.1-0012", "1.0.1", false},
	}
	for _, c := range cases {
		if got := isNewer(c.a, c.b); got != c.want {
			t.Errorf("isNewer(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestParseRelease(t *testing.T) {
	r, err := parseRelease([]byte(`{"tag_name":"v1.0.2","html_url":"https://x/r","assets":[
		{"name":"notes.txt","browser_download_url":"https://x/n"},
		{"name":"DeBarrier-1.0.2-x86_64.spk","browser_download_url":"https://x/d.spk","digest":"sha256:ABCD"}]}`))
	if err != nil || r.Version != "1.0.2" || r.SpkURL != "https://x/d.spk" || r.SHA256 != "abcd" {
		t.Fatalf("got %+v, %v", r, err)
	}
	if _, err := parseRelease([]byte(`{"tag_name":"v1","assets":[]}`)); err == nil {
		t.Fatal("expected an error with no .spk")
	}
}
