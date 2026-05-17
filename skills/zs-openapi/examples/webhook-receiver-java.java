/*
 * 紫薯通告主动推 webhook 接收端（Java 17 + Spring Boot 3）
 *
 * 运行前准备：
 *   1. 设置环境变量 WEBHOOK_SECRET=管理端创建同步端点时显示的一次性密钥
 *   2. 确保接收路由能收到原始 request body bytes
 *   3. 将 upsertBlogger(JsonNode blogger) 替换为你的落库逻辑
 */

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ZsWebhookReceiver {
  private static final long MAX_TIMESTAMP_SKEW_SECONDS = 300;

  private final ObjectMapper objectMapper;
  private final String webhookSecret;

  ZsWebhookReceiver(ObjectMapper objectMapper, @Value("${WEBHOOK_SECRET}") String webhookSecret) {
    this.objectMapper = objectMapper;
    this.webhookSecret = webhookSecret;
  }

  @PostMapping(value = "/zs-webhook", consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<Map<String, Boolean>> receive(
      @RequestBody byte[] rawBody,
      @RequestHeader("X-ZS-Timestamp") String timestamp,
      @RequestHeader("X-ZS-Signature") String signature
  ) throws Exception {
    if (!isTimestampFresh(timestamp)) {
      return ResponseEntity.status(401).build();
    }

    String expected = "sha256=" + hmacSha256Hex(rawBody, timestamp);
    if (!constantTimeEquals(expected, signature)) {
      return ResponseEntity.status(401).build();
    }

    JsonNode payload = objectMapper.readTree(rawBody);
    JsonNode bloggers = payload.path("bloggers");
    if (!bloggers.isArray()) {
      return ResponseEntity.badRequest().build();
    }

    for (JsonNode blogger : bloggers) {
      upsertBlogger(blogger);
    }

    return ResponseEntity.ok(Map.of("ok", true));
  }

  private boolean isTimestampFresh(String timestamp) {
    long requestEpochSeconds = Long.parseLong(timestamp);
    long skew = Math.abs(Instant.now().getEpochSecond() - requestEpochSeconds);
    return skew <= MAX_TIMESTAMP_SKEW_SECONDS;
  }

  private String hmacSha256Hex(byte[] rawBody, String timestamp) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    mac.update(rawBody);
    mac.update((byte) '\n');
    byte[] digest = mac.doFinal(timestamp.getBytes(StandardCharsets.UTF_8));
    return HexFormat.of().formatHex(digest);
  }

  private boolean constantTimeEquals(String expected, String actual) {
    byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
    byte[] actualBytes = actual.getBytes(StandardCharsets.UTF_8);
    return expectedBytes.length == actualBytes.length
        && MessageDigest.isEqual(expectedBytes, actualBytes);
  }

  private void upsertBlogger(JsonNode blogger) {
    // TODO: 按 (endpointId, runId, blogger.id) 做幂等去重，再写入你的业务库。
    System.out.println("received blogger: " + blogger.path("id").asText());
  }
}
