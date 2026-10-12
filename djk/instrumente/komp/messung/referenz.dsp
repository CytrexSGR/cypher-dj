import("stdfaust.lib");
// Referenz für Cypher Komp: Faust compressors.lib compressor_mono (hartes Knie), je Kanal, Parameter fest wie im Test
ratio = 4; thresh = -20; att = 0.010; rel = 0.120;
process = co.compressor_mono(ratio, thresh, att, rel), co.compressor_mono(ratio, thresh, att, rel);
