import re,sys
for line in open(sys.argv[1],encoding='utf-8'):
    l=line.rstrip('\n')
    l=re.sub(r'elapsedMs \d+','elapsedMs #',l)
    l=re.sub(r'[\d.]+ms/프레임','#ms/프레임',l)
    l=re.sub(r'경과 [\d.]+s','경과 #s',l)
    l=re.sub(r'^  f=\s*\d+\s+\d+ms', lambda m: re.sub(r'\d+ms','#ms',m.group(0)), l)
    l=re.sub(r'\s+[\d.]+ms\b',' #ms',l)
    l=re.sub(r'\s+#ms',' #ms',l)
    print(l)
