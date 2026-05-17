/*
 * 紫薯通告达人列表导入示例（Java 17 + Spring Boot 3 RestClient）
 *
 * 环境变量：
 *   ZS_API_BASE_URL=https://api.zishutonggao.com
 *   ZSK_API_KEY=zsk_xxx
 */
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
class ZsBloggerImportClient {
  private final RestClient client;

  ZsBloggerImportClient(
      @Value("${ZS_API_BASE_URL:https://api.zishutonggao.com}") String baseUrl,
      @Value("${ZSK_API_KEY}") String apiKey) {
    this.client = RestClient.builder()
        .baseUrl(baseUrl)
        .defaultHeader("X-API-Key", apiKey)
        .build();
  }

  ImportResult importPgyBloggers(List<BloggerImportItem> items, String sourceSystem) {
    if (items.size() > 500) {
      throw new IllegalArgumentException("单批最多 500 条，请分页提交");
    }
    String idempotencyKey = sourceSystem + "-" + Instant.now() + "-" + UUID.randomUUID();
    ImportRequest request = new ImportRequest(sourceSystem, items);

    return client.post()
        .uri(URI.create("/open-api/bloggers/batch"))
        .header("Idempotency-Key", idempotencyKey)
        .contentType(MediaType.APPLICATION_JSON)
        .body(request)
        .retrieve()
        .body(ImportEnvelope.class)
        .data();
  }

  record ImportRequest(String sourceSystem, List<BloggerImportItem> items) {}

  record BloggerImportItem(
      String platform,
      String url,
      String platformBloggerId,
      String nickname,
      List<String> tags,
      Map<String, Object> priceJson,
      String externalId,
      Map<String, Object> rawData) {
    static BloggerImportItem pgy(String url, String externalId) {
      return new BloggerImportItem(
          "PGY",
          url,
          null,
          null,
          List.of(),
          Map.of(),
          externalId,
          Map.of("source", "crm"));
    }
  }

  record ImportEnvelope(int code, String message, ImportResult data) {}

  record ImportResult(
      String runId,
      int total,
      int created,
      int updated,
      int failed,
      Map<String, List<String>> discardedFieldsByPlatform,
      List<ImportErrorItem> errors) {}

  record ImportErrorItem(
      int index,
      String platform,
      String platformBloggerId,
      String code,
      String message) {}
}
