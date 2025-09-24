// http://www.x.org/releases/X11R7.6/doc/fixesproto/fixesproto.txt

var x11 = require('..');
// TODO: move to templates

function parse_rectangle(buf, pos) {
    if (!pos) {
        pos = 0;
    }

    return {
        x : buf[pos],
        y : buf[pos + 1],
        width : buf[pos + 2],
        height : buf[pos + 3]
    }
}

exports.requireExt = function(display, callback)
{
    var X = display.client;
    X.QueryExtension('XFIXES', function(err, ext) {

        if (!ext.present)
            return callback(new Error('extension not available'));

        ext.QueryVersion = function(clientMaj, clientMin, callback)
        {
            X.seq_num++;
            X.pack_stream.pack('CCSLL', [ext.majorOpcode, 0, 3, clientMaj, clientMin]);
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    var res = buf.unpack('LL');
                    return res;
                },
                callback
            ];
            X.pack_stream.flush();
        }

        ext.SaveSetMode = { Insert: 0, Delete: 1 };
        ext.SaveSetTarget = { Nearest: 0, Root: 1 };
        ext.SaveSetMap = { Map: 0, Unmap: 1 };

        ext.ChangeSaveSet = function(window, mode, target, map) {
            X.seq_num++;
            X.pack_stream.pack('CCSCCxL', [ext.majorOpcode, 1, 3, mode, target, map]);
            X.pack_stream.flush();
        };

        ext.WindowRegionKind = {
            Bounding : 0,
            Clip : 1
        };

        ext.CreateRegion = function(region, rects) {
            X.seq_num ++;
            var format = 'CCSL';
            format += Array(rects.length + 1).join('ssSS');
            var args = [ ext.majorOpcode, 5, 2 + (rects.length << 1), region ];
            rects.forEach(function(rect) {
                args.push(rect.x);
                args.push(rect.y);
                args.push(rect.width);
                args.push(rect.height);
            });

            X.pack_stream.pack(format, args);
            X.pack_stream.flush();
        }

        ext.CreateRegionFromWindow = function(region, wid, kind) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLLCxxx', [ ext.majorOpcode, 7, 4, region, wid, kind ]);
            X.pack_stream.flush();
        }

        ext.DestroyRegion = function(region) {
            X.seq_num ++;
            X.pack_stream.pack('CCSL', [ ext.majorOpcode, 10, 2, region ]);
            X.pack_stream.flush();
        }

        ext.UnionRegion = function(src1, src2, dst) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLLL', [ ext.majorOpcode, 13, 4, src1, src2, dst ]);
            X.pack_stream.flush();
        }

        ext.TranslateRegion = function(region, dx, dy) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLss', [ ext.majorOpcode, 17, 3, region, dx, dy ]);
            X.pack_stream.flush();
        }

        ext.FetchRegion = function(region, cb) {
            X.seq_num ++;
            X.pack_stream.pack('CCSL', [ ext.majorOpcode, 19, 2, region ]);
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    var n_rectangles = (buf.length - 24) >> 3;
                    var format = 'ssSSxxxxxxxxxxxxxxxx';
                    format += Array(n_rectangles + 1).join('ssSS');
                    var res = buf.unpack(format);
                    var reg = {
                        extents : parse_rectangle(res),
                        rectangles : []
                    };

                    for (var i = 0; i < n_rectangles; ++ i) {
                        reg.rectangles.push(parse_rectangle(res, 4 + (i << 2)));
                    }

                    return reg;
                },
                cb
            ];

            X.pack_stream.flush();
        }

        ext.QueryVersion(5, 0, function(err, vers) {
            if (err)
                return callback(err);
            ext.major = vers[0];
            ext.minor = vers[1];
            callback(null, ext);
        });

        ext.GetCursorImage = function(callback) {
            X.seq_num++;
            // GetCursorImage là opcode 4 theo spec XFIXES
            X.pack_stream.pack('CCS', [ext.majorOpcode, 4, 1]);
            
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    try {
                        // Parse reply theo format của GetCursorImage response
                        // Format: x(INT16), y(INT16), width(CARD16), height(CARD16), 
                        //         xhot(CARD16), yhot(CARD16), cursor-serial(CARD32)
                        // Sau đó là padding và cursor image data
                        
                        var header = buf.unpack('xxxxxxssSSSSL'); // skip reply header (6 bytes) + data
                        
                        var result = {
                            x: header[0],           // INT16 - current cursor x position
                            y: header[1],           // INT16 - current cursor y position  
                            width: header[2],       // CARD16 - cursor width
                            height: header[3],      // CARD16 - cursor height
                            xhot: header[4],        // CARD16 - hotspot x offset
                            yhot: header[5],        // CARD16 - hotspot y offset
                            cursor_serial: header[6] // CARD32 - cursor serial number
                        };
                        
                        // Tính toán số pixel trong cursor image
                        var pixelCount = result.width * result.height;
                        
                        if (pixelCount > 0) {
                            // Đọc cursor image data - mỗi pixel là 32-bit ARGB
                            var imageFormat = Array(pixelCount + 1).join('L');
                            var imageStart = 32; // Skip header (32 bytes)
                            
                            if (buf.length >= imageStart + (pixelCount * 4)) {
                                var imageBuffer = buf.slice(imageStart);
                                var imageData = imageBuffer.unpack(imageFormat);
                                result.cursor_image = imageData;
                            } else {
                                result.cursor_image = [];
                            }
                        } else {
                            result.cursor_image = [];
                        }
                        
                        return result;
                        
                    } catch (err) {
                        return { error: 'Failed to parse GetCursorImage response: ' + err.message };
                    }
                },
                callback
            ];
            
            X.pack_stream.flush();
        };

        // Thêm phương thức helper để chuyển đổi cursor image data
        ext.parseCursorImagePixel = function(pixel) {
            // Cursor image format: ARGB 32-bit
            // 8 bits alpha (MSB) + 8 bits red + 8 bits green + 8 bits blue (LSB)
            // Color components are pre-multiplied with alpha
            
            return {
                alpha: (pixel >>> 24) & 0xFF,
                red:   (pixel >>> 16) & 0xFF, 
                green: (pixel >>> 8)  & 0xFF,
                blue:  pixel & 0xFF
            };
        };

        // Phương thức helper để chuyển đổi cursor image thành format khác
        ext.cursorImageToRGBA = function(cursorData) {
            if (!cursorData.cursor_image || cursorData.cursor_image.length === 0) {
                return null;
            }
            
            var rgba = [];
            for (var i = 0; i < cursorData.cursor_image.length; i++) {
                var pixel = cursorData.cursor_image[i];
                var parsed = ext.parseCursorImagePixel(pixel);
                
                rgba.push(parsed.red);
                rgba.push(parsed.green); 
                rgba.push(parsed.blue);
                rgba.push(parsed.alpha);
            }
            
            return {
                width: cursorData.width,
                height: cursorData.height,
                x: cursorData.x,
                y: cursorData.y,
                xhot: cursorData.xhot,
                yhot: cursorData.yhot,
                data: rgba
            };
        };

        ext.events = {
            DamageNotify: 0
        }

        X.eventParsers[ext.firstEvent + ext.events.DamageNotify] = function(type, seq, extra, code, raw)
        {
            var event = {};
            event.level = code;
            event.seq = seq;
            event.drawable = extra;
            var values = raw.unpack('LLssSSssSS');
            event.damage = values[0];
            event.time = values[1];
            event.area = {
              x: values[2],
              y: values[3],
              w: values[4],
              h: values[5]
            };
            event.geometry = {
              x: values[6],
              y: values[7],
              w: values[8],
              h: values[9]
            };
            event.name = 'DamageNotify';
            return event;
        };
    });
}
