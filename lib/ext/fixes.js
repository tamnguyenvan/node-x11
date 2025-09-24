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
            // Gửi yêu cầu GetCursorImage
            // Format: majorOpcode (C), minorOpcode=4 (C), requestLength=1 (S)
            X.pack_stream.pack('CCS', [ext.majorOpcode, 4, 1]);
            
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    // Phân tích cú pháp dữ liệu trả về từ server.
                    // 'buf' ở đây là toàn bộ gói tin trả về (32 bytes header + data).
                    
                    // Dựa trên tài liệu kỹ thuật, payload (sau 8 bytes header chuẩn) có cấu trúc:
                    // 2 bytes: INT16  x
                    // 2 bytes: INT16  y
                    // 2 bytes: CARD16 width
                    // 2 bytes: CARD16 height
                    // 2 bytes: CARD16 x-hot
                    // 2 bytes: CARD16 y-hot
                    // 4 bytes: CARD32 cursor-serial
                    // 8 bytes: padding
                    // Tổng cộng là 24 bytes cho phần có kích thước cố định.
                    
                    // Unpack các trường này, bắt đầu từ offset 8 của buffer.
                    var res = buf.unpack('ssSSSSL', 8);
                    
                    var result = {
                        x:             res[0],
                        y:             res[1],
                        width:         res[2],
                        height:        res[3],
                        xhot:          res[4],
                        yhot:          res[5],
                        cursor_serial: res[6]
                    };

                    var image_len_pixels = result.width * result.height;
                    
                    if (image_len_pixels === 0) {
                        result.cursor_image = Buffer.alloc(0);
                        return result;
                    }

                    var image_len_bytes = image_len_pixels * 4;

                    // Dữ liệu hình ảnh bắt đầu tại offset 32 của buffer.
                    var argb_buffer = buf.slice(32, 32 + image_len_bytes);
                    
                    // Server trả về hình ảnh ở định dạng ARGB 32-bit (pre-multiplied alpha).
                    // Chúng ta chuyển đổi nó thành buffer RGBA tiêu chuẩn.
                    var rgba_buffer = Buffer.alloc(image_len_bytes);

                    for (var i = 0; i < image_len_pixels; ++i) {
                        var offset = i * 4;
                        
                        // Pixel nguồn (ARGB): byte 0=A, byte 1=R, byte 2=G, byte 3=B
                        var a = argb_buffer[offset];
                        var r = argb_buffer[offset + 1];
                        var g = argb_buffer[offset + 2];
                        var b = argb_buffer[offset + 3];

                        // Pixel đích (RGBA): byte 0=R, byte 1=G, byte 2=B, byte 3=A
                        rgba_buffer[offset]     = r;
                        rgba_buffer[offset + 1] = g;
                        rgba_buffer[offset + 2] = b;
                        rgba_buffer[offset + 3] = a;
                    }
                    
                    result.cursor_image = rgba_buffer;
                    return result;
                },
                callback
            ];
            X.pack_stream.flush();
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
